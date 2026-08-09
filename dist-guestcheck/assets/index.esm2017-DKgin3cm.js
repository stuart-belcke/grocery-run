const re=()=>{};var M={};/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const W={NODE_ADMIN:!1,SDK_VERSION:"${JSCORE_VERSION}"};/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const ne=function(t,e){if(!t)throw se(e)},se=function(t){return new Error("Firebase Database ("+W.SDK_VERSION+") INTERNAL ASSERT FAILED: "+t)};/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const z=function(t){const e=[];let r=0;for(let s=0;s<t.length;s++){let n=t.charCodeAt(s);n<128?e[r++]=n:n<2048?(e[r++]=n>>6|192,e[r++]=n&63|128):(n&64512)===55296&&s+1<t.length&&(t.charCodeAt(s+1)&64512)===56320?(n=65536+((n&1023)<<10)+(t.charCodeAt(++s)&1023),e[r++]=n>>18|240,e[r++]=n>>12&63|128,e[r++]=n>>6&63|128,e[r++]=n&63|128):(e[r++]=n>>12|224,e[r++]=n>>6&63|128,e[r++]=n&63|128)}return e},ae=function(t){const e=[];let r=0,s=0;for(;r<t.length;){const n=t[r++];if(n<128)e[s++]=String.fromCharCode(n);else if(n>191&&n<224){const a=t[r++];e[s++]=String.fromCharCode((n&31)<<6|a&63)}else if(n>239&&n<365){const a=t[r++],o=t[r++],i=t[r++],h=((n&7)<<18|(a&63)<<12|(o&63)<<6|i&63)-65536;e[s++]=String.fromCharCode(55296+(h>>10)),e[s++]=String.fromCharCode(56320+(h&1023))}else{const a=t[r++],o=t[r++];e[s++]=String.fromCharCode((n&15)<<12|(a&63)<<6|o&63)}}return e.join("")},G={byteToCharMap_:null,charToByteMap_:null,byteToCharMapWebSafe_:null,charToByteMapWebSafe_:null,ENCODED_VALS_BASE:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",get ENCODED_VALS(){return this.ENCODED_VALS_BASE+"+/="},get ENCODED_VALS_WEBSAFE(){return this.ENCODED_VALS_BASE+"-_."},HAS_NATIVE_SUPPORT:typeof atob=="function",encodeByteArray(t,e){if(!Array.isArray(t))throw Error("encodeByteArray takes an array as a parameter");this.init_();const r=e?this.byteToCharMapWebSafe_:this.byteToCharMap_,s=[];for(let n=0;n<t.length;n+=3){const a=t[n],o=n+1<t.length,i=o?t[n+1]:0,h=n+2<t.length,d=h?t[n+2]:0,p=a>>2,c=(a&3)<<4|i>>4;let f=(i&15)<<2|d>>6,_=d&63;h||(_=64,o||(f=64)),s.push(r[p],r[c],r[f],r[_])}return s.join("")},encodeString(t,e){return this.HAS_NATIVE_SUPPORT&&!e?btoa(t):this.encodeByteArray(z(t),e)},decodeString(t,e){return this.HAS_NATIVE_SUPPORT&&!e?atob(t):ae(this.decodeStringToByteArray(t,e))},decodeStringToByteArray(t,e){this.init_();const r=e?this.charToByteMapWebSafe_:this.charToByteMap_,s=[];for(let n=0;n<t.length;){const a=r[t.charAt(n++)],i=n<t.length?r[t.charAt(n)]:0;++n;const d=n<t.length?r[t.charAt(n)]:64;++n;const c=n<t.length?r[t.charAt(n)]:64;if(++n,a==null||i==null||d==null||c==null)throw new oe;const f=a<<2|i>>4;if(s.push(f),d!==64){const _=i<<4&240|d>>2;if(s.push(_),c!==64){const te=d<<6&192|c;s.push(te)}}}return s},init_(){if(!this.byteToCharMap_){this.byteToCharMap_={},this.charToByteMap_={},this.byteToCharMapWebSafe_={},this.charToByteMapWebSafe_={};for(let t=0;t<this.ENCODED_VALS.length;t++)this.byteToCharMap_[t]=this.ENCODED_VALS.charAt(t),this.charToByteMap_[this.byteToCharMap_[t]]=t,this.byteToCharMapWebSafe_[t]=this.ENCODED_VALS_WEBSAFE.charAt(t),this.charToByteMapWebSafe_[this.byteToCharMapWebSafe_[t]]=t,t>=this.ENCODED_VALS_BASE.length&&(this.charToByteMap_[this.ENCODED_VALS_WEBSAFE.charAt(t)]=t,this.charToByteMapWebSafe_[this.ENCODED_VALS.charAt(t)]=t)}}};class oe extends Error{constructor(){super(...arguments),this.name="DecodeBase64StringError"}}const ie=function(t){const e=z(t);return G.encodeByteArray(e,!0)},J=function(t){return ie(t).replace(/\./g,"")},A=function(t){try{return G.decodeString(t,!0)}catch(e){console.error("base64Decode failed: ",e)}return null};/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Bt(t){return K(void 0,t)}function K(t,e){if(!(e instanceof Object))return e;switch(e.constructor){case Date:const r=e;return new Date(r.getTime());case Object:t===void 0&&(t={});break;case Array:t=[];break;default:return e}for(const r in e)!e.hasOwnProperty(r)||!ce(r)||(t[r]=K(t[r],e[r]));return t}function ce(t){return t!=="__proto__"}/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function he(){if(typeof self<"u")return self;if(typeof window<"u")return window;if(typeof global<"u")return global;throw new Error("Unable to locate global object.")}/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const le=()=>he().__FIREBASE_DEFAULTS__,de=()=>{if(typeof process>"u"||typeof M>"u")return;const t=M.__FIREBASE_DEFAULTS__;if(t)return JSON.parse(t)},fe=()=>{if(typeof document>"u")return;let t;try{t=document.cookie.match(/__FIREBASE_DEFAULTS__=([^;]+)/)}catch{return}const e=t&&A(t[1]);return e&&JSON.parse(e)},ue=()=>{try{return re()||le()||de()||fe()}catch(t){console.info(`Unable to get __FIREBASE_DEFAULTS__ due to: ${t}`);return}},It=t=>{var e;return(e=ue())===null||e===void 0?void 0:e[`_${t}`]};/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Ot{constructor(){this.reject=()=>{},this.resolve=()=>{},this.promise=new Promise((e,r)=>{this.resolve=e,this.reject=r})}wrapCallback(e){return(r,s)=>{r?this.reject(r):this.resolve(s),typeof e=="function"&&(this.promise.catch(()=>{}),e.length===1?e(r):e(r,s))}}}/**
 * @license
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Rt(t){try{return(t.startsWith("http://")||t.startsWith("https://")?new URL(t).hostname:t).endsWith(".cloudworkstations.dev")}catch{return!1}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function pe(){return typeof navigator<"u"&&typeof navigator.userAgent=="string"?navigator.userAgent:""}function Nt(){return typeof window<"u"&&!!(window.cordova||window.phonegap||window.PhoneGap)&&/ios|iphone|ipod|ipad|android|blackberry|iemobile/i.test(pe())}function Tt(){return typeof navigator<"u"&&navigator.userAgent==="Cloudflare-Workers"}function Mt(){const t=typeof chrome=="object"?chrome.runtime:typeof browser=="object"?browser.runtime:void 0;return typeof t=="object"&&t.id!==void 0}function $t(){return typeof navigator=="object"&&navigator.product==="ReactNative"}function Ht(){return W.NODE_ADMIN===!0}function be(){try{return typeof indexedDB=="object"}catch{return!1}}function ge(){return new Promise((t,e)=>{try{let r=!0;const s="validate-browser-context-for-indexeddb-analytics-module",n=self.indexedDB.open(s);n.onsuccess=()=>{n.result.close(),r||self.indexedDB.deleteDatabase(s),t(!0)},n.onupgradeneeded=()=>{r=!1},n.onerror=()=>{var a;e(((a=n.error)===null||a===void 0?void 0:a.message)||"")}}catch(r){e(r)}})}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const me="FirebaseError";class m extends Error{constructor(e,r,s){super(r),this.code=e,this.customData=s,this.name=me,Object.setPrototypeOf(this,m.prototype),Error.captureStackTrace&&Error.captureStackTrace(this,q.prototype.create)}}class q{constructor(e,r,s){this.service=e,this.serviceName=r,this.errors=s}create(e,...r){const s=r[0]||{},n=`${this.service}/${e}`,a=this.errors[e],o=a?_e(a,s):"Error",i=`${this.serviceName}: ${o} (${n}).`;return new m(n,i,s)}}function _e(t,e){return t.replace(ye,(r,s)=>{const n=e[s];return n!=null?String(n):`<${s}?>`})}const ye=/\{\$([^}]+)}/g;/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function $(t){return JSON.parse(t)}function xt(t){return JSON.stringify(t)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Y=function(t){let e={},r={},s={},n="";try{const a=t.split(".");e=$(A(a[0])||""),r=$(A(a[1])||""),n=a[2],s=r.d||{},delete r.d}catch{}return{header:e,claims:r,data:s,signature:n}},Pt=function(t){const e=Y(t),r=e.claims;return!!r&&typeof r=="object"&&r.hasOwnProperty("iat")},Lt=function(t){const e=Y(t).claims;return typeof e=="object"&&e.admin===!0};/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Ft(t,e){return Object.prototype.hasOwnProperty.call(t,e)}function kt(t,e){if(Object.prototype.hasOwnProperty.call(t,e))return t[e]}function Vt(t){for(const e in t)if(Object.prototype.hasOwnProperty.call(t,e))return!1;return!0}function jt(t,e,r){const s={};for(const n in t)Object.prototype.hasOwnProperty.call(t,n)&&(s[n]=e.call(r,t[n],n,t));return s}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Ut(t){const e=[];for(const[r,s]of Object.entries(t))Array.isArray(s)?s.forEach(n=>{e.push(encodeURIComponent(r)+"="+encodeURIComponent(n))}):e.push(encodeURIComponent(r)+"="+encodeURIComponent(s));return e.length?"&"+e.join("&"):""}function Wt(t){const e={};return t.replace(/^\?/,"").split("&").forEach(s=>{if(s){const[n,a]=s.split("=");e[decodeURIComponent(n)]=decodeURIComponent(a)}}),e}function zt(t){const e=t.indexOf("?");if(!e)return"";const r=t.indexOf("#",e);return t.substring(e,r>0?r:void 0)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Gt{constructor(){this.chain_=[],this.buf_=[],this.W_=[],this.pad_=[],this.inbuf_=0,this.total_=0,this.blockSize=512/8,this.pad_[0]=128;for(let e=1;e<this.blockSize;++e)this.pad_[e]=0;this.reset()}reset(){this.chain_[0]=1732584193,this.chain_[1]=4023233417,this.chain_[2]=2562383102,this.chain_[3]=271733878,this.chain_[4]=3285377520,this.inbuf_=0,this.total_=0}compress_(e,r){r||(r=0);const s=this.W_;if(typeof e=="string")for(let c=0;c<16;c++)s[c]=e.charCodeAt(r)<<24|e.charCodeAt(r+1)<<16|e.charCodeAt(r+2)<<8|e.charCodeAt(r+3),r+=4;else for(let c=0;c<16;c++)s[c]=e[r]<<24|e[r+1]<<16|e[r+2]<<8|e[r+3],r+=4;for(let c=16;c<80;c++){const f=s[c-3]^s[c-8]^s[c-14]^s[c-16];s[c]=(f<<1|f>>>31)&4294967295}let n=this.chain_[0],a=this.chain_[1],o=this.chain_[2],i=this.chain_[3],h=this.chain_[4],d,p;for(let c=0;c<80;c++){c<40?c<20?(d=i^a&(o^i),p=1518500249):(d=a^o^i,p=1859775393):c<60?(d=a&o|i&(a|o),p=2400959708):(d=a^o^i,p=3395469782);const f=(n<<5|n>>>27)+d+h+p+s[c]&4294967295;h=i,i=o,o=(a<<30|a>>>2)&4294967295,a=n,n=f}this.chain_[0]=this.chain_[0]+n&4294967295,this.chain_[1]=this.chain_[1]+a&4294967295,this.chain_[2]=this.chain_[2]+o&4294967295,this.chain_[3]=this.chain_[3]+i&4294967295,this.chain_[4]=this.chain_[4]+h&4294967295}update(e,r){if(e==null)return;r===void 0&&(r=e.length);const s=r-this.blockSize;let n=0;const a=this.buf_;let o=this.inbuf_;for(;n<r;){if(o===0)for(;n<=s;)this.compress_(e,n),n+=this.blockSize;if(typeof e=="string"){for(;n<r;)if(a[o]=e.charCodeAt(n),++o,++n,o===this.blockSize){this.compress_(a),o=0;break}}else for(;n<r;)if(a[o]=e[n],++o,++n,o===this.blockSize){this.compress_(a),o=0;break}}this.inbuf_=o,this.total_+=r}digest(){const e=[];let r=this.total_*8;this.inbuf_<56?this.update(this.pad_,56-this.inbuf_):this.update(this.pad_,this.blockSize-(this.inbuf_-56));for(let n=this.blockSize-1;n>=56;n--)this.buf_[n]=r&255,r/=256;this.compress_(this.buf_);let s=0;for(let n=0;n<5;n++)for(let a=24;a>=0;a-=8)e[s]=this.chain_[n]>>a&255,++s;return e}}function Jt(t,e){const r=new Ee(t,e);return r.subscribe.bind(r)}class Ee{constructor(e,r){this.observers=[],this.unsubscribes=[],this.observerCount=0,this.task=Promise.resolve(),this.finalized=!1,this.onNoObservers=r,this.task.then(()=>{e(this)}).catch(s=>{this.error(s)})}next(e){this.forEachObserver(r=>{r.next(e)})}error(e){this.forEachObserver(r=>{r.error(e)}),this.close(e)}complete(){this.forEachObserver(e=>{e.complete()}),this.close()}subscribe(e,r,s){let n;if(e===void 0&&r===void 0&&s===void 0)throw new Error("Missing Observer.");ve(e,["next","error","complete"])?n=e:n={next:e,error:r,complete:s},n.next===void 0&&(n.next=y),n.error===void 0&&(n.error=y),n.complete===void 0&&(n.complete=y);const a=this.unsubscribeOne.bind(this,this.observers.length);return this.finalized&&this.task.then(()=>{try{this.finalError?n.error(this.finalError):n.complete()}catch{}}),this.observers.push(n),a}unsubscribeOne(e){this.observers===void 0||this.observers[e]===void 0||(delete this.observers[e],this.observerCount-=1,this.observerCount===0&&this.onNoObservers!==void 0&&this.onNoObservers(this))}forEachObserver(e){if(!this.finalized)for(let r=0;r<this.observers.length;r++)this.sendOne(r,e)}sendOne(e,r){this.task.then(()=>{if(this.observers!==void 0&&this.observers[e]!==void 0)try{r(this.observers[e])}catch(s){typeof console<"u"&&console.error&&console.error(s)}})}close(e){this.finalized||(this.finalized=!0,e!==void 0&&(this.finalError=e),this.task.then(()=>{this.observers=void 0,this.onNoObservers=void 0}))}}function ve(t,e){if(typeof t!="object"||t===null)return!1;for(const r of e)if(r in t&&typeof t[r]=="function")return!0;return!1}function y(){}function Kt(t,e){return`${t} failed: ${e} argument `}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const qt=function(t){const e=[];let r=0;for(let s=0;s<t.length;s++){let n=t.charCodeAt(s);if(n>=55296&&n<=56319){const a=n-55296;s++,ne(s<t.length,"Surrogate pair missing trail surrogate.");const o=t.charCodeAt(s)-56320;n=65536+(a<<10)+o}n<128?e[r++]=n:n<2048?(e[r++]=n>>6|192,e[r++]=n&63|128):n<65536?(e[r++]=n>>12|224,e[r++]=n>>6&63|128,e[r++]=n&63|128):(e[r++]=n>>18|240,e[r++]=n>>12&63|128,e[r++]=n>>6&63|128,e[r++]=n&63|128)}return e},Yt=function(t){let e=0;for(let r=0;r<t.length;r++){const s=t.charCodeAt(r);s<128?e++:s<2048?e+=2:s>=55296&&s<=56319?(e+=4,r++):e+=3}return e};/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Xt(t){return t&&t._delegate?t._delegate:t}class C{constructor(e,r,s){this.name=e,this.instanceFactory=r,this.type=s,this.multipleInstances=!1,this.serviceProps={},this.instantiationMode="LAZY",this.onInstanceCreated=null}setInstantiationMode(e){return this.instantiationMode=e,this}setMultipleInstances(e){return this.multipleInstances=e,this}setServiceProps(e){return this.serviceProps=e,this}setInstanceCreatedCallback(e){return this.onInstanceCreated=e,this}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */var l;(function(t){t[t.DEBUG=0]="DEBUG",t[t.VERBOSE=1]="VERBOSE",t[t.INFO=2]="INFO",t[t.WARN=3]="WARN",t[t.ERROR=4]="ERROR",t[t.SILENT=5]="SILENT"})(l||(l={}));const Se={debug:l.DEBUG,verbose:l.VERBOSE,info:l.INFO,warn:l.WARN,error:l.ERROR,silent:l.SILENT},we=l.INFO,De={[l.DEBUG]:"log",[l.VERBOSE]:"log",[l.INFO]:"info",[l.WARN]:"warn",[l.ERROR]:"error"},Ae=(t,e,...r)=>{if(e<t.logLevel)return;const s=new Date().toISOString(),n=De[e];if(n)console[n](`[${s}]  ${t.name}:`,...r);else throw new Error(`Attempted to log a message with an invalid logType (value: ${e})`)};class Ce{constructor(e){this.name=e,this._logLevel=we,this._logHandler=Ae,this._userLogHandler=null}get logLevel(){return this._logLevel}set logLevel(e){if(!(e in l))throw new TypeError(`Invalid value "${e}" assigned to \`logLevel\``);this._logLevel=e}setLogLevel(e){this._logLevel=typeof e=="string"?Se[e]:e}get logHandler(){return this._logHandler}set logHandler(e){if(typeof e!="function")throw new TypeError("Value assigned to `logHandler` must be a function");this._logHandler=e}get userLogHandler(){return this._userLogHandler}set userLogHandler(e){this._userLogHandler=e}debug(...e){this._userLogHandler&&this._userLogHandler(this,l.DEBUG,...e),this._logHandler(this,l.DEBUG,...e)}log(...e){this._userLogHandler&&this._userLogHandler(this,l.VERBOSE,...e),this._logHandler(this,l.VERBOSE,...e)}info(...e){this._userLogHandler&&this._userLogHandler(this,l.INFO,...e),this._logHandler(this,l.INFO,...e)}warn(...e){this._userLogHandler&&this._userLogHandler(this,l.WARN,...e),this._logHandler(this,l.WARN,...e)}error(...e){this._userLogHandler&&this._userLogHandler(this,l.ERROR,...e),this._logHandler(this,l.ERROR,...e)}}const Be=(t,e)=>e.some(r=>t instanceof r);let H,x;function Ie(){return H||(H=[IDBDatabase,IDBObjectStore,IDBIndex,IDBCursor,IDBTransaction])}function Oe(){return x||(x=[IDBCursor.prototype.advance,IDBCursor.prototype.continue,IDBCursor.prototype.continuePrimaryKey])}const X=new WeakMap,B=new WeakMap,Q=new WeakMap,E=new WeakMap,N=new WeakMap;function Re(t){const e=new Promise((r,s)=>{const n=()=>{t.removeEventListener("success",a),t.removeEventListener("error",o)},a=()=>{r(b(t.result)),n()},o=()=>{s(t.error),n()};t.addEventListener("success",a),t.addEventListener("error",o)});return e.then(r=>{r instanceof IDBCursor&&X.set(r,t)}).catch(()=>{}),N.set(e,t),e}function Ne(t){if(B.has(t))return;const e=new Promise((r,s)=>{const n=()=>{t.removeEventListener("complete",a),t.removeEventListener("error",o),t.removeEventListener("abort",o)},a=()=>{r(),n()},o=()=>{s(t.error||new DOMException("AbortError","AbortError")),n()};t.addEventListener("complete",a),t.addEventListener("error",o),t.addEventListener("abort",o)});B.set(t,e)}let I={get(t,e,r){if(t instanceof IDBTransaction){if(e==="done")return B.get(t);if(e==="objectStoreNames")return t.objectStoreNames||Q.get(t);if(e==="store")return r.objectStoreNames[1]?void 0:r.objectStore(r.objectStoreNames[0])}return b(t[e])},set(t,e,r){return t[e]=r,!0},has(t,e){return t instanceof IDBTransaction&&(e==="done"||e==="store")?!0:e in t}};function Te(t){I=t(I)}function Me(t){return t===IDBDatabase.prototype.transaction&&!("objectStoreNames"in IDBTransaction.prototype)?function(e,...r){const s=t.call(v(this),e,...r);return Q.set(s,e.sort?e.sort():[e]),b(s)}:Oe().includes(t)?function(...e){return t.apply(v(this),e),b(X.get(this))}:function(...e){return b(t.apply(v(this),e))}}function $e(t){return typeof t=="function"?Me(t):(t instanceof IDBTransaction&&Ne(t),Be(t,Ie())?new Proxy(t,I):t)}function b(t){if(t instanceof IDBRequest)return Re(t);if(E.has(t))return E.get(t);const e=$e(t);return e!==t&&(E.set(t,e),N.set(e,t)),e}const v=t=>N.get(t);function He(t,e,{blocked:r,upgrade:s,blocking:n,terminated:a}={}){const o=indexedDB.open(t,e),i=b(o);return s&&o.addEventListener("upgradeneeded",h=>{s(b(o.result),h.oldVersion,h.newVersion,b(o.transaction),h)}),r&&o.addEventListener("blocked",h=>r(h.oldVersion,h.newVersion,h)),i.then(h=>{a&&h.addEventListener("close",()=>a()),n&&h.addEventListener("versionchange",d=>n(d.oldVersion,d.newVersion,d))}).catch(()=>{}),i}const xe=["get","getKey","getAll","getAllKeys","count"],Pe=["put","add","delete","clear"],S=new Map;function P(t,e){if(!(t instanceof IDBDatabase&&!(e in t)&&typeof e=="string"))return;if(S.get(e))return S.get(e);const r=e.replace(/FromIndex$/,""),s=e!==r,n=Pe.includes(r);if(!(r in(s?IDBIndex:IDBObjectStore).prototype)||!(n||xe.includes(r)))return;const a=async function(o,...i){const h=this.transaction(o,n?"readwrite":"readonly");let d=h.store;return s&&(d=d.index(i.shift())),(await Promise.all([d[r](...i),n&&h.done]))[0]};return S.set(e,a),a}Te(t=>({...t,get:(e,r,s)=>P(e,r)||t.get(e,r,s),has:(e,r)=>!!P(e,r)||t.has(e,r)}));/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Le{constructor(e){this.container=e}getPlatformInfoString(){return this.container.getProviders().map(r=>{if(Fe(r)){const s=r.getImmediate();return`${s.library}/${s.version}`}else return null}).filter(r=>r).join(" ")}}function Fe(t){const e=t.getComponent();return(e==null?void 0:e.type)==="VERSION"}const O="@firebase/app",L="0.13.2";/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const u=new Ce("@firebase/app"),ke="@firebase/app-compat",Ve="@firebase/analytics-compat",je="@firebase/analytics",Ue="@firebase/app-check-compat",We="@firebase/app-check",ze="@firebase/auth",Ge="@firebase/auth-compat",Je="@firebase/database",Ke="@firebase/data-connect",qe="@firebase/database-compat",Ye="@firebase/functions",Xe="@firebase/functions-compat",Qe="@firebase/installations",Ze="@firebase/installations-compat",et="@firebase/messaging",tt="@firebase/messaging-compat",rt="@firebase/performance",nt="@firebase/performance-compat",st="@firebase/remote-config",at="@firebase/remote-config-compat",ot="@firebase/storage",it="@firebase/storage-compat",ct="@firebase/firestore",ht="@firebase/ai",lt="@firebase/firestore-compat",dt="firebase",ft="11.10.0",ut={[O]:"fire-core",[ke]:"fire-core-compat",[je]:"fire-analytics",[Ve]:"fire-analytics-compat",[We]:"fire-app-check",[Ue]:"fire-app-check-compat",[ze]:"fire-auth",[Ge]:"fire-auth-compat",[Je]:"fire-rtdb",[Ke]:"fire-data-connect",[qe]:"fire-rtdb-compat",[Ye]:"fire-fn",[Xe]:"fire-fn-compat",[Qe]:"fire-iid",[Ze]:"fire-iid-compat",[et]:"fire-fcm",[tt]:"fire-fcm-compat",[rt]:"fire-perf",[nt]:"fire-perf-compat",[st]:"fire-rc",[at]:"fire-rc-compat",[ot]:"fire-gcs",[it]:"fire-gcs-compat",[ct]:"fire-fst",[lt]:"fire-fst-compat",[ht]:"fire-vertex","fire-js":"fire-js",[dt]:"fire-js-all"};/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const pt=new Map,bt=new Map,F=new Map;function k(t,e){try{t.container.addComponent(e)}catch(r){u.debug(`Component ${e.name} failed to register with FirebaseApp ${t.name}`,r)}}function R(t){const e=t.name;if(F.has(e))return u.debug(`There were multiple attempts to register component ${e}.`),!1;F.set(e,t);for(const r of pt.values())k(r,t);for(const r of bt.values())k(r,t);return!0}function Qt(t){return t==null?!1:t.settings!==void 0}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const gt={"no-app":"No Firebase App '{$appName}' has been created - call initializeApp() first","bad-app-name":"Illegal App name: '{$appName}'","duplicate-app":"Firebase App named '{$appName}' already exists with different options or config","app-deleted":"Firebase App named '{$appName}' already deleted","server-app-deleted":"Firebase Server App has been deleted","no-options":"Need to provide options, when not being deployed to hosting via source.","invalid-app-argument":"firebase.{$appName}() takes either no argument or a Firebase App instance.","invalid-log-argument":"First argument to `onLog` must be null or a function.","idb-open":"Error thrown when opening IndexedDB. Original error: {$originalErrorMessage}.","idb-get":"Error thrown when reading from IndexedDB. Original error: {$originalErrorMessage}.","idb-set":"Error thrown when writing to IndexedDB. Original error: {$originalErrorMessage}.","idb-delete":"Error thrown when deleting from IndexedDB. Original error: {$originalErrorMessage}.","finalization-registry-not-supported":"FirebaseServerApp deleteOnDeref field defined but the JS runtime does not support FinalizationRegistry.","invalid-server-app-environment":"FirebaseServerApp is not for use in browser environments."},T=new q("app","Firebase",gt);/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Zt=ft;function w(t,e,r){var s;let n=(s=ut[t])!==null&&s!==void 0?s:t;r&&(n+=`-${r}`);const a=n.match(/\s|\//),o=e.match(/\s|\//);if(a||o){const i=[`Unable to register library "${n}" with version "${e}":`];a&&i.push(`library name "${n}" contains illegal characters (whitespace or "/")`),a&&o&&i.push("and"),o&&i.push(`version name "${e}" contains illegal characters (whitespace or "/")`),u.warn(i.join(" "));return}R(new C(`${n}-version`,()=>({library:n,version:e}),"VERSION"))}/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const mt="firebase-heartbeat-database",_t=1,g="firebase-heartbeat-store";let D=null;function Z(){return D||(D=He(mt,_t,{upgrade:(t,e)=>{switch(e){case 0:try{t.createObjectStore(g)}catch(r){console.warn(r)}}}}).catch(t=>{throw T.create("idb-open",{originalErrorMessage:t.message})})),D}async function yt(t){try{const r=(await Z()).transaction(g),s=await r.objectStore(g).get(ee(t));return await r.done,s}catch(e){if(e instanceof m)u.warn(e.message);else{const r=T.create("idb-get",{originalErrorMessage:e==null?void 0:e.message});u.warn(r.message)}}}async function V(t,e){try{const s=(await Z()).transaction(g,"readwrite");await s.objectStore(g).put(e,ee(t)),await s.done}catch(r){if(r instanceof m)u.warn(r.message);else{const s=T.create("idb-set",{originalErrorMessage:r==null?void 0:r.message});u.warn(s.message)}}}function ee(t){return`${t.name}!${t.options.appId}`}/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Et=1024,vt=30;class St{constructor(e){this.container=e,this._heartbeatsCache=null;const r=this.container.getProvider("app").getImmediate();this._storage=new Dt(r),this._heartbeatsCachePromise=this._storage.read().then(s=>(this._heartbeatsCache=s,s))}async triggerHeartbeat(){var e,r;try{const n=this.container.getProvider("platform-logger").getImmediate().getPlatformInfoString(),a=j();if(((e=this._heartbeatsCache)===null||e===void 0?void 0:e.heartbeats)==null&&(this._heartbeatsCache=await this._heartbeatsCachePromise,((r=this._heartbeatsCache)===null||r===void 0?void 0:r.heartbeats)==null)||this._heartbeatsCache.lastSentHeartbeatDate===a||this._heartbeatsCache.heartbeats.some(o=>o.date===a))return;if(this._heartbeatsCache.heartbeats.push({date:a,agent:n}),this._heartbeatsCache.heartbeats.length>vt){const o=At(this._heartbeatsCache.heartbeats);this._heartbeatsCache.heartbeats.splice(o,1)}return this._storage.overwrite(this._heartbeatsCache)}catch(s){u.warn(s)}}async getHeartbeatsHeader(){var e;try{if(this._heartbeatsCache===null&&await this._heartbeatsCachePromise,((e=this._heartbeatsCache)===null||e===void 0?void 0:e.heartbeats)==null||this._heartbeatsCache.heartbeats.length===0)return"";const r=j(),{heartbeatsToSend:s,unsentEntries:n}=wt(this._heartbeatsCache.heartbeats),a=J(JSON.stringify({version:2,heartbeats:s}));return this._heartbeatsCache.lastSentHeartbeatDate=r,n.length>0?(this._heartbeatsCache.heartbeats=n,await this._storage.overwrite(this._heartbeatsCache)):(this._heartbeatsCache.heartbeats=[],this._storage.overwrite(this._heartbeatsCache)),a}catch(r){return u.warn(r),""}}}function j(){return new Date().toISOString().substring(0,10)}function wt(t,e=Et){const r=[];let s=t.slice();for(const n of t){const a=r.find(o=>o.agent===n.agent);if(a){if(a.dates.push(n.date),U(r)>e){a.dates.pop();break}}else if(r.push({agent:n.agent,dates:[n.date]}),U(r)>e){r.pop();break}s=s.slice(1)}return{heartbeatsToSend:r,unsentEntries:s}}class Dt{constructor(e){this.app=e,this._canUseIndexedDBPromise=this.runIndexedDBEnvironmentCheck()}async runIndexedDBEnvironmentCheck(){return be()?ge().then(()=>!0).catch(()=>!1):!1}async read(){if(await this._canUseIndexedDBPromise){const r=await yt(this.app);return r!=null&&r.heartbeats?r:{heartbeats:[]}}else return{heartbeats:[]}}async overwrite(e){var r;if(await this._canUseIndexedDBPromise){const n=await this.read();return V(this.app,{lastSentHeartbeatDate:(r=e.lastSentHeartbeatDate)!==null&&r!==void 0?r:n.lastSentHeartbeatDate,heartbeats:e.heartbeats})}else return}async add(e){var r;if(await this._canUseIndexedDBPromise){const n=await this.read();return V(this.app,{lastSentHeartbeatDate:(r=e.lastSentHeartbeatDate)!==null&&r!==void 0?r:n.lastSentHeartbeatDate,heartbeats:[...n.heartbeats,...e.heartbeats]})}else return}}function U(t){return J(JSON.stringify({version:2,heartbeats:t})).length}function At(t){if(t.length===0)return-1;let e=0,r=t[0].date;for(let s=1;s<t.length;s++)t[s].date<r&&(r=t[s].date,e=s);return e}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Ct(t){R(new C("platform-logger",e=>new Le(e),"PRIVATE")),R(new C("heartbeat",e=>new St(e),"PRIVATE")),w(O,L,t),w(O,L,"esm2017"),w("fire-js","")}Ct("");export{zt as A,Mt as B,C,Ot as D,q as E,m as F,A as G,Rt as H,Tt as I,It as J,Jt as K,Ce as L,pe as M,Gt as S,R as _,ne as a,l as b,Ft as c,kt as d,Kt as e,xt as f,Xt as g,qt as h,G as i,se as j,$ as k,Qt as l,jt as m,Lt as n,Pt as o,Vt as p,Ut as q,w as r,Yt as s,Nt as t,$t as u,Bt as v,ie as w,Ht as x,Zt as y,Wt as z};
