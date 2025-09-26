const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const simpleGit = require('simple-git');

const app = express();
const PORT = 3000;

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/run-lighthouse', async (req, res) => {
    const { urls, projectPath, branch1, branch2 } = req.body;

    if (!urls || urls.length === 0) {
        return res.status(400).json({ error: 'Mindestens eine URL ist erforderlich' });
    }

    try {
        const results = {};

        if (branch1 && branch2 && projectPath) {
            results.branch1 = await runLighthouseForBranch(urls, projectPath, branch1);
            results.branch2 = await runLighthouseForBranch(urls, projectPath, branch2);
            results.comparison = compareBranches(results.branch1, results.branch2, branch1, branch2);
        } else {
            results.single = await runLighthouseForUrls(urls);
        }

        res.json(results);
    } catch (error) {
        console.error('Fehler beim Ausführen von Lighthouse:', error);
        res.status(500).json({ error: error.message });
    }
});

async function runLighthouseForBranch(urls, projectPath, branch) {
    const git = simpleGit(projectPath);

    try {
        // Überprüfen ob das Verzeichnis ein Git-Repository ist
        const isRepo = await git.checkIsRepo();
        if (!isRepo) {
            throw new Error(`${projectPath} ist kein Git-Repository`);
        }

        // Branch auschecken
        await git.checkout(branch);
        console.log(`Branch ${branch} in ${projectPath} ausgecheckt`);

        return await runLighthouseForUrls(urls, branch, projectPath);
    } catch (error) {
        throw new Error(`Fehler beim Checkout von Branch ${branch}: ${error.message}`);
    }
}

async function runLighthouseForUrls(urls, branch = null, projectPath = null) {
    const results = [];

    for (const url of urls) {
        try {
            const result = await runSingleLighthouse(url, branch, projectPath);
            results.push(result);
        } catch (error) {
            results.push({
                url,
                branch,
                error: error.message
            });
        }
    }

    return results;
}

function runSingleLighthouse(url, branch = null, projectPath = null) {
    return new Promise((resolve, reject) => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `lighthouse-${timestamp}-${branch || 'single'}.json`;

        const lighthouseOptions = {
            cwd: projectPath || process.cwd()
        };

        const lighthouse = spawn('lighthouse', [
            url,
            '--output=json',
            '--output-path=' + filename,
            '--chrome-flags="--headless --no-sandbox"'
        ], lighthouseOptions);

        let stdout = '';
        let stderr = '';

        lighthouse.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        lighthouse.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        lighthouse.on('close', async (code) => {
            if (code === 0) {
                try {
                    const reportPath = projectPath ? path.join(projectPath, filename) : filename;
                    const reportData = await fs.readFile(reportPath, 'utf8');
                    const report = JSON.parse(reportData);


                    await fs.unlink(reportPath);

                    // Validierung der Report-Struktur - kann lhr enthalten oder direkt sein
                    const lhr = report.lhr || report;
                    if (!lhr || !lhr.categories || !lhr.audits) {
                        throw new Error('Ungültiger Lighthouse-Report: Fehlende Datenstruktur');
                    }

                    const categories = lhr.categories;
                    const audits = lhr.audits;

                    // Sichere Score-Extraktion mit Fallback-Werten
                    const getScore = (category) => {
                        return categories[category] && categories[category].score !== null
                            ? Math.round(categories[category].score * 100)
                            : 0;
                    };

                    // Sichere Metrik-Extraktion mit Fallback-Werten
                    const getMetric = (auditName) => {
                        return audits[auditName] && audits[auditName].numericValue !== null
                            ? audits[auditName].numericValue
                            : 0;
                    };

                    resolve({
                        url,
                        branch,
                        scores: {
                            performance: getScore('performance'),
                            accessibility: getScore('accessibility'),
                            'best-practices': getScore('best-practices'),
                            seo: getScore('seo')
                        },
                        metrics: {
                            'first-contentful-paint': getMetric('first-contentful-paint'),
                            'largest-contentful-paint': getMetric('largest-contentful-paint'),
                            'speed-index': getMetric('speed-index'),
                            'cumulative-layout-shift': getMetric('cumulative-layout-shift'),
                            'total-blocking-time': getMetric('total-blocking-time')
                        }
                    });
                } catch (error) {
                    reject(new Error(`Fehler beim Parsen des Lighthouse-Reports: ${error.message}`));
                }
            } else {
                reject(new Error(`Lighthouse fehlgeschlagen mit Code ${code}: ${stderr}`));
            }
        });
    });
}

function compareBranches(branch1Results, branch2Results, branch1Name, branch2Name) {
    const comparison = {
        baseline: branch1Name,
        comparison: branch2Name,
        improvements: [],
        regressions: [],
        detailed: [],
        summary: {}
    };

    for (let i = 0; i < branch1Results.length; i++) {
        const result1 = branch1Results[i];
        const result2 = branch2Results[i];

        if (result1.error || result2.error || !result1.scores || !result2.scores || !result1.metrics || !result2.metrics) continue;

        const urlComparison = {
            url: result1.url,
            scoreChanges: {},
            metricChanges: {},
            improvements: {
                scores: [],
                metrics: []
            },
            regressions: {
                scores: [],
                metrics: []
            }
        };

        // Sichere Score-Vergleiche mit granularen Details
        for (const [category, score1] of Object.entries(result1.scores || {})) {
            const score2 = result2.scores[category];
            if (typeof score1 === 'number' && typeof score2 === 'number') {
                const change = score2 - score1;
                const changeObj = {
                    category: getCategoryDisplayName(category),
                    baseline: score1,
                    comparison: score2,
                    change: change,
                    improvement: change > 0,
                    changePercent: score1 > 0 ? Math.round((change / score1) * 100) : 0,
                    impact: getScoreImpact(Math.abs(change))
                };

                urlComparison.scoreChanges[category] = changeObj;

                if (change > 0) {
                    urlComparison.improvements.scores.push(changeObj);
                } else if (change < 0) {
                    urlComparison.regressions.scores.push(changeObj);
                }
            }
        }

        // Sichere Metrik-Vergleiche mit granularen Details
        for (const [metric, value1] of Object.entries(result1.metrics || {})) {
            const value2 = result2.metrics[metric];
            if (typeof value1 === 'number' && typeof value2 === 'number') {
                const change = value2 - value1;
                const isImprovement = change < 0; // Für Metriken ist kleiner besser
                const changeObj = {
                    metric: getMetricDisplayName(metric),
                    baseline: value1,
                    comparison: value2,
                    change: change,
                    improvement: isImprovement,
                    changePercent: value1 > 0 ? Math.round((Math.abs(change) / value1) * 100) : 0,
                    formattedBaseline: formatMetricValue(metric, value1),
                    formattedComparison: formatMetricValue(metric, value2),
                    formattedChange: formatMetricChange(metric, change),
                    impact: getMetricImpact(metric, Math.abs(change), value1)
                };

                urlComparison.metricChanges[metric] = changeObj;

                if (isImprovement) {
                    urlComparison.improvements.metrics.push(changeObj);
                } else if (change !== 0) {
                    urlComparison.regressions.metrics.push(changeObj);
                }
            }
        }

        // Sammle alle URLs für detaillierte Ansicht
        comparison.detailed.push(urlComparison);

        const hasImprovements = urlComparison.improvements.scores.length > 0 || urlComparison.improvements.metrics.length > 0;
        const hasRegressions = urlComparison.regressions.scores.length > 0 || urlComparison.regressions.metrics.length > 0;

        if (hasImprovements) {
            comparison.improvements.push(urlComparison);
        }
        if (hasRegressions) {
            comparison.regressions.push(urlComparison);
        }
    }

    // Erweiterte Zusammenfassung
    comparison.summary = {
        totalUrls: branch1Results.length,
        urlsWithImprovements: comparison.improvements.length,
        urlsWithRegressions: comparison.regressions.length,
        totalImprovements: comparison.detailed.reduce((sum, url) =>
            sum + url.improvements.scores.length + url.improvements.metrics.length, 0),
        totalRegressions: comparison.detailed.reduce((sum, url) =>
            sum + url.regressions.scores.length + url.regressions.metrics.length, 0)
    };

    return comparison;
}

function getCategoryDisplayName(category) {
    const names = {
        'performance': 'Performance',
        'accessibility': 'Zugänglichkeit',
        'best-practices': 'Best Practices',
        'seo': 'SEO'
    };
    return names[category] || category;
}

function getMetricDisplayName(metric) {
    const names = {
        'first-contentful-paint': 'First Contentful Paint (FCP)',
        'largest-contentful-paint': 'Largest Contentful Paint (LCP)',
        'speed-index': 'Speed Index',
        'cumulative-layout-shift': 'Cumulative Layout Shift (CLS)',
        'total-blocking-time': 'Total Blocking Time (TBT)'
    };
    return names[metric] || metric;
}

function formatMetricValue(metric, value) {
    if (metric === 'cumulative-layout-shift') {
        return value.toFixed(3);
    }
    return Math.round(value) + 'ms';
}

function formatMetricChange(metric, change) {
    const prefix = change > 0 ? '+' : '';
    if (metric === 'cumulative-layout-shift') {
        return prefix + change.toFixed(3);
    }
    return prefix + Math.round(change) + 'ms';
}

function getScoreImpact(change) {
    if (change >= 20) return 'Hoch';
    if (change >= 10) return 'Mittel';
    if (change >= 5) return 'Niedrig';
    return 'Minimal';
}

function getMetricImpact(metric, absChange, baseline) {
    if (metric === 'cumulative-layout-shift') {
        if (absChange >= 0.25) return 'Hoch';
        if (absChange >= 0.1) return 'Mittel';
        if (absChange >= 0.05) return 'Niedrig';
        return 'Minimal';
    }

    // Für Zeit-basierte Metriken
    const changePercent = baseline > 0 ? (absChange / baseline) * 100 : 0;
    if (changePercent >= 50) return 'Hoch';
    if (changePercent >= 25) return 'Mittel';
    if (changePercent >= 10) return 'Niedrig';
    return 'Minimal';
}

app.listen(PORT, () => {
    console.log(`Lighthouse Test Suite läuft auf http://localhost:${PORT}`);
});