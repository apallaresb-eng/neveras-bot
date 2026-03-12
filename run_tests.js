const { exec } = require('child_process');
const fs = require('fs');

exec('npx jest --no-color', { env: { ...process.env, CI: 'true' } }, (err, stdout, stderr) => {
    fs.writeFileSync('c:\\neveras-bot\\test_results.txt', `STDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
});
