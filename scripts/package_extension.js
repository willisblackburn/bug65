const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const EXT_DIR = path.join(ROOT_DIR, 'packages', 'bug65-vscode-extension');
const STAGING_DIR = path.join(ROOT_DIR, '.staging_extension');

function run(command, cwd) {
    console.log(`> ${command}`);
    execSync(command, { cwd: cwd, stdio: 'inherit' });
}

function copy(src, dest) {
    console.log(`Copying ${src} to ${dest}`);
    fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
    console.log(`Copying directory ${src} to ${dest}`);
    fs.cpSync(src, dest, { recursive: true });
}

try {
    // 1. Build the extension (bundle to dist/)
    console.log('--- Building Extension ---');
    run('npm run package', EXT_DIR);

    // 2. Prepare Staging Area
    console.log('--- Preparing Staging Area ---');
    if (fs.existsSync(STAGING_DIR)) {
        fs.rmSync(STAGING_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(STAGING_DIR);

    // 3. Copy artifacts
    // Map dist/ -> out/ so package.json paths remain valid
    copyDir(path.join(EXT_DIR, 'dist'), path.join(STAGING_DIR, 'out'));

    // Copy manifest (and strip prepublish to avoid vsce running it)
    const pkg = require(path.join(EXT_DIR, 'package.json'));
    delete pkg.scripts['vscode:prepublish'];
    fs.writeFileSync(path.join(STAGING_DIR, 'package.json'), JSON.stringify(pkg, null, 4));

    // Copy License and Readme from Root
    copy(path.join(ROOT_DIR, 'LICENSE.md'), path.join(STAGING_DIR, 'LICENSE.md'));
    copy(path.join(ROOT_DIR, 'README.md'), path.join(STAGING_DIR, 'README.md'));

    // 4. Package
    console.log('--- Packaging VSIX ---');
    const vscePath = path.resolve(ROOT_DIR, 'node_modules', '.bin', 'vsce');
    run(`${vscePath} package --no-dependencies --out ../bug65-vscode-extension.vsix`, STAGING_DIR);

    console.log('--- Done ---');
    console.log(`VSIX created at: ${path.join(ROOT_DIR, 'bug65-vscode-extension.vsix')}`);

} catch (e) {
    console.error('Packaging failed:', e);
    process.exit(1);
}
