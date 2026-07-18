const fs = require('fs');
const p = 'Version-2-Gold-Trading/components/layout.js';
let content = fs.readFileSync(p, 'utf8');

// Replace the span wrapper with an anchor wrapper for the ticker item
content = content.replace(
  '<span class="ticker-tape__item" data-dir="${dirClass}">',
  '<a href="signal.html?symbol=${symbol}" class="ticker-tape__item ticker-link" data-dir="${dirClass}">'
);

content = content.replace(
  '<polyline points="${sparkPoints}" />\n      </svg>\n    </span>`;',
  '<polyline points="${sparkPoints}" />\n      </svg>\n    </a>`;'
);

fs.writeFileSync(p, content, 'utf8');
console.log('Fixed layout.js');
