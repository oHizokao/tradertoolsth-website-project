const fs = require('fs');
const path = require('path');
let count = 0;
function walk(dir) {
    fs.readdirSync(dir).forEach(f => {
        let p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) {
            walk(p);
        } else if (f.endsWith('.js') || f.endsWith('.html')) {
            let c = fs.readFileSync(p, 'utf8');
            let o = c;
            c = c.replace(/\bbtn\s+btn--primary\b/g, 'v2-btn v2-btn--primary');
            c = c.replace(/\bbtn\s+btn--teal\b/g, 'v2-btn v2-btn--primary');
            c = c.replace(/\bbtn\s+btn--ghost-light\b/g, 'v2-btn v2-btn--outline');
            c = c.replace(/\bbtn\s+btn--ghost\b/g, 'v2-btn v2-btn--outline');
            c = c.replace(/\bbtn\s+btn--soft\b/g, 'v2-btn v2-btn--outline');
            c = c.replace(/\bbtn--sm\b/g, 'v2-btn--sm');
            c = c.replace(/\bbtn--xs\b/g, 'v2-btn--sm');
            c = c.replace(/\bbtn--lg\b/g, 'v2-btn--lg');
            c = c.replace(/\bbtn--block\b/g, 'v2-btn--block');
            c = c.replace(/\bbtn\b/g, 'v2-btn');
            // specifically fix double v2-btn if any
            c = c.replace(/v2-btn\s+v2-btn--primary/g, 'v2-btn v2-btn--primary');
            if (c !== o) {
                fs.writeFileSync(p, c, 'utf8');
                console.log('Updated', p);
                count++;
            }
        }
    });
}
walk('Version-2-Gold-Trading');
console.log('Fixed', count);
