/**
 * Organize extracted proto files into proper directory structure
 * matching their import paths.
 */
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'docs', 'protos');
const dstDir = path.join(__dirname, '..', 'src', 'language-server', 'protos');

// Read all extracted proto files
const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.proto'));

for (const file of files) {
  const content = fs.readFileSync(path.join(srcDir, file), 'utf-8');
  
  // Extract the original path from the filename
  // Filename format: path_segments_file.proto (underscores replace slashes)
  // But we need the actual original name from the file content or infer from package
  
  // Strategy: look for option go_package or known patterns
  // Actually, we can reconstruct from the descriptor data
  const descriptors = JSON.parse(fs.readFileSync(path.join(__dirname, 'proto-descriptors-full.json'), 'utf-8'));
  
  // Build mapping from flat filename to original path
  const fileMap = {};
  for (const desc of descriptors) {
    const flatName = desc.name.replace(/\//g, '_');
    fileMap[flatName] = desc.name;
  }
  
  const originalPath = fileMap[file];
  if (!originalPath) {
    console.log(`  SKIP: ${file} (no mapping found)`);
    continue;
  }
  
  const dstPath = path.join(dstDir, originalPath);
  const dstDirPath = path.dirname(dstPath);
  
  if (!fs.existsSync(dstDirPath)) {
    fs.mkdirSync(dstDirPath, { recursive: true });
  }
  
  fs.copyFileSync(path.join(srcDir, file), dstPath);
  console.log(`  ${originalPath}`);
}

console.log('\nDone! Proto files organized into src/language-server/protos/');
