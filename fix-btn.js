const fs = require('fs');
const path = require('path');

function processDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDir(fullPath);
    } else if (fullPath.endsWith('.js')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      let original = content;

      content = content.replace(/v2-v2-btn/g, 'v2-btn');
      content = content.replace(/\(v2-btn\)/g, '(btn)');
      content = content.replace(/const v2-btn\b/g, 'const btn');
      content = content.replace(/let v2-btn\b/g, 'let btn');
      content = content.replace(/if \(v2-btn\)/g, 'if (btn)');
      content = content.replace(/!v2-btn\b/g, '!btn');
      content = content.replace(/v2-btn\./g, 'btn.');
      content = content.replace(/v2-btn,/g, 'btn,');
      content = content.replace(/function\(v2-btn/g, 'function(btn');
      content = content.replace(/, v2-btn\b/g, ', btn');
      content = content.replace(/v2-btn =/g, 'btn =');
      content = content.replace(/\[v2-btn\]/g, '[btn]');
      content = content.replace(/return v2-btn\b/g, 'return btn');

      if (content !== original) {
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log('Fixed', fullPath);
      }
    }
  }
}

processDir('Version-2-Gold-Trading');
console.log('Done');
