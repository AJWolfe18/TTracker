# Receipt share card - reference markup (chosen August 29, 2026)

Source: design canvas https://claude.ai/code/artifact/a77a84dd-3904-412c-ab32-aa76363abe8c (exported here so ADO-571 does not depend on the canvas). Main = 44px headline; LongTitle = 32px headline. Satori port lives in netlify/edge-functions/_shared/og-card.tsx.

## Main.dc.html

```html
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,500;0,6..72,600;1,6..72,500&family=JetBrains+Mono:wght@400;500;700&family=Archivo+Black&family=Archivo:wght@500;700;800&display=swap">
  <style>
    body { margin: 0; background: #0a0a0b; }
    a { color: #c94a3e; } a:hover { color: #e8bcb5; }
  </style>
</helmet>
<div style="width: 1200px; height: 630px; box-sizing: border-box; background: #0a0a0b; position: relative; overflow: hidden; display: flex; flex-direction: row; align-items: center; justify-content: space-between; padding: 0 64px;">
  <div style="display: flex; flex-direction: column; gap: 28px; width: 380px;">
    <div style="font-family: 'Newsreader', Georgia, serif; font-weight: 600; font-size: 40px; line-height: 1; color: #f5f5f4; letter-spacing: -0.02em;">TRUMPY<br><span style="color: #c94a3e;">/</span>TRACKER</div>
    <div style="font-family: 'Newsreader', Georgia, serif; font-style: italic; font-size: 26px; line-height: 1.3; color: #a3a3a3;">Keeping receipts on every scandal, pardon, and power grab.</div>
    <div style="font-family: 'JetBrains Mono', monospace; font-size: 18px; color: #f5f5f4; letter-spacing: 0.1em; text-transform: uppercase;">trumpytracker.com</div>
  </div>
  <div style="width: 640px; background: #f3efe6; color: #1a1a1a; padding: 40px 44px; box-sizing: border-box; display: flex; flex-direction: column; gap: 22px; box-shadow: 0 30px 60px rgba(0,0,0,0.6); transform: rotate(-1.2deg); position: relative;">
    <div style="display: flex; justify-content: space-between; font-family: 'JetBrains Mono', monospace; font-size: 16px; letter-spacing: 0.12em; text-transform: uppercase; color: #4a4e56;">
      <span>Receipt No. 16879</span>
      <span>April 12, 2026</span>
    </div>
    <div style="border-top: 2px dashed #b9b2a4;"></div>
    <div style="font-family: 'Newsreader', Georgia, serif; font-weight: 500; font-size: 44px; line-height: 1.08; letter-spacing: -0.02em; text-wrap: balance;">Judges Fired After Blocking Deportations of Pro-Palestinian Students</div>
    <div style="border-top: 2px dashed #b9b2a4;"></div>
    <div style="display: flex; flex-direction: column; gap: 10px; font-family: 'JetBrains Mono', monospace; font-size: 17px; letter-spacing: 0.06em; text-transform: uppercase; color: #1a1a1a;">
      <div style="display: flex; justify-content: space-between;"><span>Filed under</span><span>Story</span></div>
      <div style="display: flex; justify-content: space-between; align-items: center;"><span style="font-weight: 700;">Alarm level</span><span style="background: #c94a3e; color: #f5f5f4; padding: 6px 12px; font-weight: 700;">5 · Constitutional Dumpster Fire</span></div>
    </div>
  </div>
</div>
```

## LongTitle.dc.html

```html
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,500;0,6..72,600;1,6..72,500&family=JetBrains+Mono:wght@400;500;700&family=Archivo+Black&family=Archivo:wght@500;700;800&display=swap">
  <style>
    body { margin: 0; background: #0a0a0b; }
    a { color: #c94a3e; } a:hover { color: #e8bcb5; }
  </style>
</helmet>
<div style="width: 1200px; height: 630px; box-sizing: border-box; background: #0a0a0b; position: relative; overflow: hidden; display: flex; flex-direction: row; align-items: center; justify-content: space-between; padding: 0 64px;">
  <div style="display: flex; flex-direction: column; gap: 28px; width: 380px;">
    <div style="font-family: 'Newsreader', Georgia, serif; font-weight: 600; font-size: 40px; line-height: 1; color: #f5f5f4; letter-spacing: -0.02em;">TRUMPY<br><span style="color: #c94a3e;">/</span>TRACKER</div>
    <div style="font-family: 'Newsreader', Georgia, serif; font-style: italic; font-size: 26px; line-height: 1.3; color: #a3a3a3;">Keeping receipts on every scandal, pardon, and power grab.</div>
    <div style="font-family: 'JetBrains Mono', monospace; font-size: 18px; color: #f5f5f4; letter-spacing: 0.1em; text-transform: uppercase;">trumpytracker.com</div>
  </div>
  <div style="width: 640px; background: #f3efe6; color: #1a1a1a; padding: 40px 44px; box-sizing: border-box; display: flex; flex-direction: column; gap: 22px; box-shadow: 0 30px 60px rgba(0,0,0,0.6); transform: rotate(-1.2deg); position: relative;">
    <div style="display: flex; justify-content: space-between; font-family: 'JetBrains Mono', monospace; font-size: 16px; letter-spacing: 0.12em; text-transform: uppercase; color: #4a4e56;">
      <span>Receipt No. 16891</span>
      <span>April 13, 2026</span>
    </div>
    <div style="border-top: 2px dashed #b9b2a4;"></div>
    <div style="font-family: 'Newsreader', Georgia, serif; font-weight: 500; font-size: 32px; line-height: 1.12; letter-spacing: -0.02em; text-wrap: balance;">Trump news at a glance: president signals more mass pardons in pipeline; Vance leaves Pakistan after Iran peace talks break down</div>
    <div style="border-top: 2px dashed #b9b2a4;"></div>
    <div style="display: flex; flex-direction: column; gap: 10px; font-family: 'JetBrains Mono', monospace; font-size: 17px; letter-spacing: 0.06em; text-transform: uppercase; color: #1a1a1a;">
      <div style="display: flex; justify-content: space-between;"><span>Filed under</span><span>Story</span></div>
      <div style="display: flex; justify-content: space-between; align-items: center;"><span style="font-weight: 700;">Alarm level</span><span style="background: #c94a3e; color: #f5f5f4; padding: 6px 12px; font-weight: 700;">5 · Constitutional Dumpster Fire</span></div>
    </div>
  </div>
</div>
```

