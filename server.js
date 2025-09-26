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
        summary: {}
    };

    for (let i = 0; i < branch1Results.length; i++) {
        const result1 = branch1Results[i];
        const result2 = branch2Results[i];

        if (result1.error || result2.error || !result1.scores || !result2.scores || !result1.metrics || !result2.metrics) continue;

        const urlComparison = {
            url: result1.url,
            scoreChanges: {},
            metricChanges: {}
        };

        // Sichere Score-Vergleiche
        for (const [category, score1] of Object.entries(result1.scores || {})) {
            const score2 = result2.scores[category];
            if (typeof score1 === 'number' && typeof score2 === 'number') {
                const change = score2 - score1;
                urlComparison.scoreChanges[category] = {
                    baseline: score1,
                    comparison: score2,
                    change: change,
                    improvement: change > 0
                };
            }
        }

        // Sichere Metrik-Vergleiche
        for (const [metric, value1] of Object.entries(result1.metrics || {})) {
            const value2 = result2.metrics[metric];
            if (typeof value1 === 'number' && typeof value2 === 'number') {
                const change = value2 - value1;
                const isImprovement = change < 0;
                urlComparison.metricChanges[metric] = {
                    baseline: value1,
                    comparison: value2,
                    change: change,
                    improvement: isImprovement
                };
            }
        }

        const hasImprovements = Object.values(urlComparison.scoreChanges).some(c => c.improvement) ||
                               Object.values(urlComparison.metricChanges).some(c => c.improvement);
        const hasRegressions = Object.values(urlComparison.scoreChanges).some(c => !c.improvement && c.change !== 0) ||
                              Object.values(urlComparison.metricChanges).some(c => !c.improvement && c.change !== 0);

        if (hasImprovements) {
            comparison.improvements.push(urlComparison);
        }
        if (hasRegressions) {
            comparison.regressions.push(urlComparison);
        }
    }

    comparison.summary = {
        totalUrls: branch1Results.length,
        urlsWithImprovements: comparison.improvements.length,
        urlsWithRegressions: comparison.regressions.length
    };

    return comparison;
}

app.listen(PORT, () => {
    console.log(`Lighthouse Test Suite läuft auf http://localhost:${PORT}`);
});