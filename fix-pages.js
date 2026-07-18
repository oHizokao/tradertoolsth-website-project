const fs = require('fs');
const p = 'Version-2-Gold-Trading/styles/pages.css';
let content = fs.readFileSync(p, 'utf8');

if (!content.includes('.ticker-tape__item:hover')) {
  const hoverCss = `
/* Added for Clickable Ticker Tape */
.ticker-tape__item.ticker-link {
  text-decoration: none;
  transition: all 0.2s ease;
  cursor: pointer;
}
.ticker-tape__item.ticker-link:hover {
  background: linear-gradient(135deg, rgba(23, 61, 97, 0.95), rgba(15, 37, 57, 0.95));
  border-color: rgba(226, 182, 72, 0.5);
  box-shadow: 0 0 10px rgba(226, 182, 72, 0.15);
}
`;
  fs.appendFileSync(p, hoverCss, 'utf8');
}
console.log('Fixed pages.css');
