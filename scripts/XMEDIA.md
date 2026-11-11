# Collecting post media (video, photos, quoted post, links) for new items

The app renders X posts natively from Firestore `xmedia/c*` docs (map of tweetId → post data).
X's data endpoint blocks cross-origin reads, so collect it in the built-in browser:

## Step 1 — on X's data origin
Navigate a tab to `https://cdn.syndication.twimg.com/tweet-result?id=<any new id>&lang=en&token=a`, then run
(replace IDS with the new tweet ids):

```js
const IDS=[/* new tweet ids */];
const P=s=>s?s.replace('https://pbs.twimg.com/',''):'';
const V=m=>{const vs=(m.video_info?.variants||[]).filter(v=>v.content_type==='video/mp4').sort((a,b)=>(b.bitrate||0)-(a.bitrate||0));const best=vs.find(v=>/\/(1280x720|720x1280|1080x\d+|\d+x1080|720x\d+)\//.test(v.url))||vs[0];return best?{s:best.url,p:P(m.media_url_https),m:Math.round((m.video_info.duration_millis||0)/1000)}:null};
const pack=t=>{if(!t||!t.id_str)return null;const md=t.mediaDetails||[];const vid=md.find(m=>m.type==='video'||m.type==='animated_gif');return{id:t.id_str,h:'@'+(t.user?.screen_name||''),n:t.user?.name||'',t:(t.text||'').slice(0,1500),u:(t.entities?.urls||[]).map(u=>({d:u.display_url,url:u.expanded_url})),ph:md.filter(m=>m.type==='photo').map(m=>P(m.media_url_https)),v:vid?V(vid):null}};
const out={};for(const id of IDS){const r=await fetch(`/tweet-result?id=${id}&lang=en&token=a`);if(!r.ok)continue;const j=await r.json();const o=pack(j);if(o){o.q=j.quoted_tweet?pack(j.quoted_tweet):null;out[id]=o;}}
location.href='https://knowledge-library-788e1.web.app/?relay=1#xmedia='+encodeURIComponent(JSON.stringify(out));
```

## Step 2 — in the Stash tab it lands on (signed in), after ~8 s run:

```js
const v='10.12.2';const F=await import(`https://www.gstatic.com/firebasejs/${v}/firebase-app.js`);const S=await import(`https://www.gstatic.com/firebasejs/${v}/firebase-firestore.js`);
const X=JSON.parse(decodeURIComponent(location.hash.slice(8)));const db=S.getFirestore(F.getApp());
const snaps=await S.getDocs(S.collection(db,'xmedia'));let target='c0',n=0;snaps.docs.forEach(d=>{const k=Object.keys(d.data()).length;if(k<400){target=d.id;}n=Math.max(n,+d.id.slice(1)+1);});
if(snaps.docs.every(d=>Object.keys(d.data()).length>=400))target='c'+n;
await S.setDoc(S.doc(db,'xmedia',target),X,{merge:true});history.replaceState(null,'','/');Object.keys(X).length
```
Nested arrays are not allowed in Firestore: keep `u` as a list of {d,url} objects (as above).
