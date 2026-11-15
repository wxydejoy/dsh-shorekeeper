#!/usr/bin/env node
/** LAN 固定地址门卫：:3093 → dsh web :3090，token 自动补签。
 *
 * 痛点：dsh web 的 ?token= 每次重启轮换，书签必死，新设备激活都要回 Mac 抓新链接。
 * 这个门卫把「拿 token」收进服务端：局域网永远访问 http://<LAN>:3093/，
 * 请求没带 dsh-auth cookie 就 302 到同路径 + 当前 token（从
 * ~/.dsh/logs/dsh-web.out.log 尾部抓最新一条）；带了就原样透传。
 * 上游 401（cookie 失效）也补一次 token 重定向，浏览器无感重活。
 * WebSocket（upgrade）双向透传，会话流不受影响。
 *
 * 注意：cookie 按 host 共享、不区分端口——经 :3093 激活后 :3090 直连同样生效。
 * 但 dsh 的 cookie 里钉了 authority（签发时的 Host），所以本门卫转发时会把
 * Host/Origin/Referer 统一改写成目标 authority，否则上游按 Host 校验会 401。
 *
 * TLS：给 GATE_TLS_CERT/GATE_TLS_KEY 就以 HTTPS 起监听（:3092 给安卓开语音用，
 * getUserMedia 要 secure context）。TLS 这条同样改 Host 到 :3090，所以两边共用
 * 一份 cookie：在任意一个入口登录过，另一个入口不用再登。
 *
 * 环境变量：GATE_LISTEN（默认 0.0.0.0:3093）、GATE_TARGET（默认 10.14.14.117:3090）、
 * GATE_TLS_CERT / GATE_TLS_KEY（给了则走 HTTPS）。
 * launchd：cn.weiekko.dsh-web-lan-gate2（HTTP :3093）、
 * cn.weiekko.dsh-web-lan-gate-tls（HTTPS :3092）。
 */
const http = require('node:http')
const https = require('node:https')
const { join } = require('node:path')
const { homedir } = require('node:os')
const { readFileSync } = require('node:fs')

const [GATE_HOST, GATE_PORT] = (process.env.GATE_LISTEN || '0.0.0.0:3093').split(':')
const [TARGET_HOST, TARGET_PORT] = (process.env.GATE_TARGET || '10.14.14.117:3090').split(':')
const TOKEN_LOG = join(homedir(), '.dsh', 'logs', 'dsh-web.out.log')
const TLS_CERT = process.env.GATE_TLS_CERT || ''
const TLS_KEY = process.env.GATE_TLS_KEY || ''
const TLS = TLS_CERT !== '' && TLS_KEY !== ''

/** 从 dsh web 日志尾部抓最新 token（重启即轮换，永远用最新一条）。 */
async function currentToken() {
  const { open } = require('node:fs/promises')
  let fh
  try {
    fh = await open(TOKEN_LOG, 'r')
  } catch {
    return null
  }
  try {
    const size = (await fh.stat()).size
    const start = Math.max(0, size - 8192)
    const buf = Buffer.alloc(size - start)
    await fh.read(buf, 0, buf.length, start)
    const matches = buf.toString('utf8').match(/token=([A-Za-z0-9_-]+)/g)
    return matches ? matches[matches.length - 1].slice(6) : null
  } catch {
    return null
  } finally {
    await fh.close()
  }
}

function hasAuthCookie(req) {
  return /(?:^|;\s*)dsh-auth-[^=]+=/.test(req.headers.cookie || '')
}

/** 转发头：Host/Origin/Referer 统一改写成目标 authority——dsh 的 /api 浏览器
 *  信任栅栏按 Origin/Referer 判，:3093 的请求不改写会全被 403。 */
function forwardHeaders(req) {
  const authority = `${TARGET_HOST}:${TARGET_PORT}`
  const origin = `http://${authority}`
  const headers = { ...req.headers, host: authority }
  if (headers.origin) headers.origin = origin
  if (headers.referer) headers.referer = `${origin}/`
  return headers
}

async function redirectWithToken(req, res, token) {
  const sep = req.url.includes('?') ? '&' : '?'
  res.writeHead(302, { location: `${req.url}${sep}token=${token}`, 'cache-control': 'no-store' })
  res.end()
}

async function handle(req, res) {
  const token = await currentToken()
  if (token && !hasAuthCookie(req) && !/[?&]token=/.test(req.url)) {
    return redirectWithToken(req, res, token)
  }
  const upstream = http.request(
    {
      host: TARGET_HOST,
      port: TARGET_PORT,
      path: req.url,
      method: req.method,
      headers: forwardHeaders(req),
    },
    (up) => {
      if (up.statusCode === 401 && token) {
        up.resume()
        return redirectWithToken(req, res, token)
      }
      res.writeHead(up.statusCode, up.headers)
      up.pipe(res)
    },
  )
  upstream.on('error', () => {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('lan-gate: dsh web 不可达')
  })
  req.pipe(upstream)
}

const server = TLS
  ? https.createServer(
      { cert: readFileSync(TLS_CERT), key: readFileSync(TLS_KEY) },
      (req, res) => void handle(req, res),
    )
  : http.createServer((req, res) => void handle(req, res))

/** WebSocket 透传：握手转给上游，之后裸 TCP 双向对接。 */
server.on('upgrade', (req, socket) => {
  const upstream = http.request({
    host: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    headers: forwardHeaders(req),
  })
  upstream.on('upgrade', (upRes, upSocket, upHead) => {
    const lines = [`HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage ?? ''}`.trimEnd()]
    for (const [key, value] of Object.entries(upRes.headers)) lines.push(`${key}: ${value}`)
    socket.write(`${lines.join('\r\n')}\r\n\r\n`)
    if (upHead?.length) socket.write(upHead)
    upSocket.pipe(socket)
    socket.pipe(upSocket)
    socket.on('error', () => upSocket.destroy())
    upSocket.on('error', () => socket.destroy())
  })
  upstream.on('error', () => socket.destroy())
  upstream.end()
})

server.listen(Number(GATE_PORT), GATE_HOST === '0.0.0.0' ? undefined : GATE_HOST, () => {
  const scheme = TLS ? 'https' : 'http'
  console.log(`lan-gate: ${scheme}://${GATE_HOST}:${GATE_PORT} -> http://${TARGET_HOST}:${TARGET_PORT}`)
})
