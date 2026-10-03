import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { handleApi, runChecks, seed } from '../core/api.ts';
import { sqliteStore } from './sqlite-store.mjs';

const port=Number(process.env.PORT??3000), hosts=process.env.MONITOR_ALLOWED_HOSTS??'';
const root=resolve(process.env.PUBLIC_DIR ?? fileURLToPath(new URL('./dist/public/',import.meta.url)));
const token=process.env.DASHBOARD_TOKEN??'';
if(process.env.NODE_ENV==='production'&&token.length<24)throw new Error('Set DASHBOARD_TOKEN to a random value of at least 24 characters.');
const store=process.env.STORAGE==='dynamodb'
  ? (await import('./dynamo-store.mjs')).dynamoStore(process.env.DYNAMODB_TABLE??'cloudpulse')
  : sqliteStore(process.env.SQLITE_PATH??'./data/cloudpulse.db');
await seed(store);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json'};
function authorized(req) {
  if(!token)return true;
  const raw=req.headers.authorization??'';
  if(!raw.startsWith('Basic '))return false;
  const decoded=Buffer.from(raw.slice(6),'base64').toString();
  const pass=decoded.slice(decoded.indexOf(':')+1);
  const a=Buffer.from(pass),b=Buffer.from(token);
  return a.length===b.length&&timingSafeEqual(a,b);
}
const server=createServer(async(req,res)=>{
  const started=Date.now();
  try {
    const path=new URL(req.url??'/', 'http://localhost').pathname;
    if(path!=='/api/health'&&!authorized(req)){res.writeHead(401,{'WWW-Authenticate':'Basic realm="CloudPulse", charset="UTF-8"','Content-Type':'text/plain'});res.end('Authentication required.');return;}
    if(path.startsWith('/api/')) {
      let raw='',size=0;for await(const chunk of req){size+=chunk.length;if(size>8192){res.writeHead(413);res.end('Request too large');return;}raw+=chunk.toString();}
      const requestHeaders=new Headers();for(const[k,v]of Object.entries(req.headers))if(v!==undefined)requestHeaders.set(k,Array.isArray(v)?v.join(','):v);
      const protocol=req.headers['x-forwarded-proto']==='https'?'https':'http';
      const request=new Request(`${protocol}://${req.headers.host??'localhost'}${req.url}`,{method:req.method,headers:requestHeaders,...(raw?{body:raw}:{})});
      const response=await handleApi(request,store,{allowedHosts:hosts,mode:process.env.STORAGE==='dynamodb'?'AWS workspace':'Local workspace'});
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
    } else {
      if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
      let file=resolve(root, '.'+decodeURIComponent(path));
      if(!file.startsWith(root+sep)&&file!==root){res.writeHead(403);res.end();return;}
      try {if((await stat(file)).isDirectory())file=resolve(file,'index.html');}catch {file=resolve(root,'index.html');}
      const content=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':extname(file)==='.html'?'no-cache':'public, max-age=3600'});res.end(req.method==='HEAD'?undefined:content);
    }
  } catch(e){console.error(JSON.stringify({level:'error',event:'request_failed',message:e.message}));if(!res.headersSent)res.writeHead(500);res.end('Server error');}
  finally {console.log(JSON.stringify({event:'request',method:req.method,path:(req.url??'').split('?')[0],status:res.statusCode,durationMs:Date.now()-started}));}
});
server.requestTimeout=15000;server.headersTimeout=10000;
server.listen(port,process.env.HOST ?? (process.env.NODE_ENV==='production'?'0.0.0.0':'127.0.0.1'),()=>console.log(JSON.stringify({event:'listening',port:server.address().port,storage:process.env.STORAGE??'sqlite'})));
const interval=Number(process.env.CHECK_INTERVAL_SECONDS??60);
if(!Number.isFinite(interval)||interval<0||(interval>0&&interval<30))throw new Error('CHECK_INTERVAL_SECONDS must be 0 or at least 30.');
const timer=interval?setInterval(()=>runChecks(store,hosts).catch(e=>{if(e.status!==409)console.error(JSON.stringify({event:'scheduled_check_failed',message:e.message}))}),interval*1000):null;
let stopping=false;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{if(stopping)return;stopping=true;if(timer)clearInterval(timer);server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),10000).unref();});
