import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
export const COOKIE='modelhub_session'; const TTL=12*60*60;
const cfg=(env=process.env)=>({username:String(env.ADMIN_USERNAME||'admin').trim().toLowerCase(),password:String(env.ADMIN_PASSWORD||''),secret:String(env.SESSION_SECRET||'')});
const eq=(a,b)=>timingSafeEqual(createHash('sha256').update(String(a)).digest(),createHash('sha256').update(String(b)).digest());
const sig=(v,s)=>createHmac('sha256',s).update(v).digest('base64url');
export function credentials(user,pass,env=process.env){const c=cfg(env);return Boolean(c.password&&eq(user.toLowerCase(),c.username)&&eq(pass,c.password))}
export function createSession(user,role='admin',env=process.env,now=Date.now()){const c=cfg(env);if(!c.secret)throw Error('SESSION_SECRET 未配置');const p=Buffer.from(JSON.stringify({sub:user,role,iat:Math.floor(now/1000),exp:Math.floor(now/1000)+TTL,nonce:randomBytes(12).toString('base64url')})).toString('base64url');return `${p}.${sig(p,c.secret)}`}
export function readSession(headers,env=process.env,now=Date.now()){const c=cfg(env);const raw=headers?.cookie||headers?.Cookie||'';const token=raw.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1)||'';const [p,s]=token.split('.');if(!p||!s||!c.secret||!eq(s,sig(p,c.secret)))return null;try{const x=JSON.parse(Buffer.from(p,'base64url').toString());return x.exp>Math.floor(now/1000)?x:null}catch{return null}}
export const setCookie=t=>`${COOKIE}=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL}; Secure`;
export const clearCookie=()=>`${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`;
