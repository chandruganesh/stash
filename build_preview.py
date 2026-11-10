import re
p='public/'
html=open(p+'index.html').read(); css=open(p+'style.css').read(); js=open(p+'app.js').read(); data=open('data/library.json').read()
js=js.replace("async load(){ const r = await fetch('data.json', {cache:'no-store'}); return r.json(); }","async load(){ return window.__DATA; }")
html=html.replace('<link rel="stylesheet" href="style.css">','<style>'+css+'</style>')
html=html.replace('<script src="config.js"></script>\n<script src="app.js" type="module"></script>','<script>window.STASH_CONFIG={mode:"local"};window.__DATA='+data+';</script>\n<script type="module">'+js+'</script>')
html=re.sub(r'<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\n','',html)
open('Stash-preview.html','w').write(html)
