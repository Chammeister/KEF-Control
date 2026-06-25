/*
 * KEF Connect capture proxy
 * -------------------------
 * A tiny HTTP forwarding proxy that LOGS every request the KEF Connect phone
 * app makes to the speaker (method, URL, headers, body) and forwards it on, so
 * the app keeps working normally while we watch the traffic.
 *
 * We use this to discover the authorization KEF Connect sends when it writes
 * DSP settings (which our app currently gets 401 Forbidden on).
 *
 * USAGE
 *   1. On the PC:  node kef-capture-proxy.js
 *   2. Note the PC's LAN IP it prints (or run `ipconfig`).
 *   3. On the phone: Wi-Fi settings -> your network -> Proxy = Manual,
 *        Host = <PC IP>, Port = 8888.
 *   4. Open KEF Connect, go to DSP settings, toggle e.g. Phase Correction.
 *   5. Copy the logged "POST .../api/setData" block (headers + body) here.
 *   6. When done: set the phone Proxy back to None/Off.
 *
 * Only plain-HTTP /api/ calls are logged; HTTPS is tunneled untouched so the
 * rest of the app keeps functioning.
 */

const http = require("http");
const net = require("net");
const { URL } = require("url");
const os = require("os");

const PORT = 8888;

const server = http.createServer((req, res) => {
  let target;
  try {
    target = new URL(req.url);
  } catch {
    res.writeHead(400);
    res.end("bad request url");
    return;
  }

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");

    if (req.url.includes("/api/")) {
      const star = req.url.includes("/api/setData") ? " <<<<< WRITE" : "";
      console.log("\n==================== " + new Date().toLocaleTimeString() + star);
      console.log(req.method + " " + req.url);
      console.log("HEADERS: " + JSON.stringify(req.headers, null, 2));
      if (body) console.log("BODY: " + body);
    }

    const opts = {
      hostname: target.hostname,
      port: target.port || 80,
      path: target.pathname + target.search,
      method: req.method,
      headers: req.headers,
    };
    const fwd = http.request(opts, (fres) => {
      res.writeHead(fres.statusCode, fres.headers);
      fres.pipe(res);
    });
    fwd.on("error", (e) => {
      res.writeHead(502);
      res.end(String(e));
    });
    if (body) fwd.write(body);
    fwd.end();
  });
});

// Tunnel HTTPS (CONNECT) untouched so KEF Connect's cloud calls keep working.
server.on("connect", (req, clientSocket, head) => {
  const [host, port] = req.url.split(":");
  const serverSocket = net.connect(Number(port) || 443, host, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });
  serverSocket.on("error", () => clientSocket.end());
  clientSocket.on("error", () => serverSocket.end());
});

function lanIPs() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name]) {
      if (i.family === "IPv4" && !i.internal) out.push(`${i.address}  (${name})`);
    }
  }
  return out;
}

server.listen(PORT, "0.0.0.0", () => {
  console.log("KEF capture proxy listening on port " + PORT);
  console.log("Set your phone's Wi-Fi proxy to one of these PC addresses:");
  for (const ip of lanIPs()) console.log("   " + ip + ":" + PORT);
  console.log("\nThen change a DSP setting in KEF Connect and watch for a WRITE line below.\n");
});
