const http = require('node:http');
const {createHmac, randomBytes, timingSafeEqual} = require('node:crypto');
const {Readable} = require('node:stream');

const AUTH_ERROR = '后端身份验证失败，已停止发送数据，请重启应用';
const proof = (secret, message) => createHmac('sha256', secret).update(message).digest('hex');

function createBackendClient({port, secret}) {
  const lifetime = new AbortController();
  async function request(endpoint, options = {}) {
    const signal = AbortSignal.any([lifetime.signal, options.signal || AbortSignal.timeout(60000)]);
    signal.throwIfAborted();
    const agent = new http.Agent({keepAlive:true, maxSockets:1});
    const abort = () => agent.destroy();
    signal.addEventListener('abort', abort, {once:true});
    const dispose = () => {signal.removeEventListener('abort', abort);agent.destroy();};
    const send = (route, config = {}, expectedSocket) => new Promise((resolve, reject) => {
      const req = http.request({hostname:'127.0.0.1', port, path:route, agent,
        method:config.method || 'GET', headers:config.headers, signal}, resolve);
      req.on('error', reject);
      req.on('socket', socket => {
        // Never send credentials on a replacement TCP connection. Even a server
        // replaced immediately after the handshake cannot receive the body.
        if (expectedSocket && socket !== expectedSocket) {
          req.destroy(new Error(AUTH_ERROR));return;
        }
        req.end(config.body);
      });
    });
    try {
      const nonce = randomBytes(32).toString('hex');
      const hello = await send(`/auth?nonce=${nonce}`);
      const socket = hello.socket;
      if (hello.statusCode !== 200) throw new Error(AUTH_ERROR);
      let text = '';
      for await (const chunk of hello) {
        text += chunk.toString('utf8');
        if (text.length > 4096) throw new Error(AUTH_ERROR);
      }
      let answer;
      try {answer = JSON.parse(text).proof;} catch {throw new Error(AUTH_ERROR);}
      const expected = proof(secret, `server\n${nonce}`);
      if (typeof answer !== 'string' || !/^[a-f0-9]{64}$/.test(answer) ||
          !timingSafeEqual(Buffer.from(answer), Buffer.from(expected))) throw new Error(AUTH_ERROR);
      signal.throwIfAborted();
      const response = await send(endpoint, {...options, headers:{...options.headers,
        Authorization:`Bearer ${proof(secret, 'client')}`}}, socket);
      if (response.statusCode === 401 || response.statusCode === 403) throw new Error(AUTH_ERROR);
      response.once('end', dispose);response.once('close', dispose);response.once('error', dispose);
      return new Response(Readable.toWeb(response), {status:response.statusCode,
        headers:Object.fromEntries(Object.entries(response.headers).filter(([,v])=>v !== undefined))});
    } catch (error) {
      dispose();throw error;
    }
  }
  return {request, close:() => lifetime.abort(new Error('后端已停止，请重启应用'))};
}

module.exports = {createBackendClient, AUTH_ERROR};
