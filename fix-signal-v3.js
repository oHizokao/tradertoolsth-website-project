const fs = require('fs');
const file = 'Version-2-Gold-Trading/signal.js';
let code = fs.readFileSync(file, 'utf8');

const splitPoint = '  document.addEventListener("DOMContentLoaded", render);\n})();';
const parts = code.split(splitPoint);
let baseCode = parts[0];

const newLogic = `  document.addEventListener("DOMContentLoaded", () => {
    const urlParams = new URLSearchParams(window.location.search);
    const targetSymbol = urlParams.get('symbol');

    if (targetSymbol) {
      renderSymbolDetail(targetSymbol);
    } else {
      render();
    }
  });

  function renderSymbolDetail(symbol) {
    const main = \`
      \${TT.layout.ticker()}
      <section class="page">
        <div class="container">
          <div class="symbol-detail-header" style="margin-bottom: 24px; padding: 16px; background: rgba(15, 37, 57, 0.6); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 12px; display: flex; align-items: center; gap: 16px;">
            <div style="width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg, rgba(226, 182, 72, 0.2), rgba(226, 182, 72, 0.05)); display: flex; align-items: center; justify-content: center; border: 1px solid rgba(226, 182, 72, 0.3);">
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="2" style="width: 20px; height: 20px;"><path d="M3 3v18h18M7 14l5-5 4 4 5-5"/></svg>
            </div>
            <div>
              <h1 style="margin: 0; font-size: 24px; color: #fff; font-weight: 600;">\${symbol.toUpperCase()}</h1>
              <p style="margin: 4px 0 0 0; font-size: 14px; color: rgba(255, 255, 255, 0.5);">Advanced Real-time Chart & Technical Analysis</p>
            </div>
            <a href="signal.html" class="v2-btn v2-btn--outline" style="margin-left: auto; text-decoration: none;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px; margin-right: 8px;"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
              à¸à¸¥à¸±à¸šà¹„à¸›à¸«à¸™à¹‰à¸²à¸£à¸§à¸¡ Signal
            </a>
          </div>

          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 24px; min-height: 600px; padding-bottom: 40px;">
            <!-- Main Chart Widget -->
            <div class="tv-widget-box" style="background: rgba(15, 37, 57, 0.4); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 12px; overflow: hidden; height: 600px;">
              <div class="tradingview-widget-container" style="height: 100%; width: 100%;">
                <div id="tradingview_chart" style="height: 100%; width: 100%;"></div>
              </div>
            </div>

            <!-- Tech Analysis Widget -->
            <div class="tv-widget-box" style="background: rgba(15, 37, 57, 0.4); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 12px; overflow: hidden; height: 600px;">
              <div class="tradingview-widget-container" style="height: 100%; width: 100%;">
                <div class="tradingview-widget-container__widget" id="tradingview_tech" style="height: 100%; width: 100%;"></div>
              </div>
            </div>
          </div>
        </div>
      </section>
    \`;

    document.getElementById("app").innerHTML = TT.layout.page({
      active: "signal",
      main: main,
    });
    TT.layout.initNavbar();

    // Inject TradingView Advanced Chart script
    const script1 = document.createElement('script');
    script1.src = "https://s3.tradingview.com/tv.js";
    script1.async = true;
    script1.onload = () => {
      new TradingView.widget({
        "autosize": true,
        "symbol": \`FX_IDC:\${symbol.toUpperCase()}\`,
        "interval": "D",
        "timezone": "Etc/UTC",
        "theme": "dark",
        "style": "1",
        "locale": "en",
        "enable_publishing": false,
        "backgroundColor": "rgba(15, 37, 57, 1)",
        "gridColor": "rgba(255, 255, 255, 0.05)",
        "hide_top_toolbar": false,
        "hide_legend": false,
        "save_image": false,
        "container_id": "tradingview_chart"
      });
    };
    document.body.appendChild(script1);

    // Inject TradingView Technical Analysis script
    const script2 = document.createElement('script');
    script2.src = "https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js";
    script2.async = true;
    script2.innerHTML = JSON.stringify({
      "interval": "1m",
      "width": "100%",
      "isTransparent": true,
      "height": "100%",
      "symbol": \`FX_IDC:\${symbol.toUpperCase()}\`,
      "showIntervalTabs": true,
      "displayMode": "single",
      "locale": "en",
      "colorTheme": "dark"
    });

    setTimeout(() => {
        const techContainer = document.getElementById('tradingview_tech');
        if(techContainer) techContainer.appendChild(script2);
    }, 100);
  }
})();
`;
fs.writeFileSync(file, baseCode + newLogic);
console.log("Success");
