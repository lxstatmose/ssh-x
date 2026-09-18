const net = require('net');

const connections = new Map(); // tabId -> { socket, cols, rows, partialIacBuffer }

// Telnet protocol constants
const IAC = 255;  // Interpret As Command
const DONT = 254;
const DO = 253;
const WONT = 252;
const WILL = 251;
const SB = 250;   // Subnegotiation Begin
const SE = 240;   // Subnegotiation End
const NAWS = 31;  // Negotiate About Window Size
const ECHO = 1;   // Echo option
const SGA = 3;    // Suppress Go Ahead
const BINARY = 0; // Binary Transmission

/**
 * Process raw Telnet data: strip IAC negotiation sequences and
 * respond to DO/WILL requests from the server.
 * Handles partial IAC sequences across packet boundaries.
 * Returns clean text safe to display.
 */
function processTelnetData(rawBuffer, conn) {
  const bytes = Buffer.from(rawBuffer);
  const cleanBytes = [];
  let i = 0;

  // Prepend any partial IAC sequence from previous packet
  if (conn.partialIacBuffer && conn.partialIacBuffer.length > 0) {
    const combined = Buffer.concat([conn.partialIacBuffer, bytes]);
    conn.partialIacBuffer = Buffer.alloc(0);
    return processTelnetData(combined, conn);
  }

  while (i < bytes.length) {
    const b = bytes[i];

    if (b !== IAC) {
      cleanBytes.push(bytes[i]);
      i++;
      continue;
    }

    // IAC sequence - check if we have enough bytes
    if (i + 1 >= bytes.length) {
      // Incomplete IAC sequence at end of buffer - save for next packet
      conn.partialIacBuffer = bytes.slice(i);
      break;
    }

    const cmd = bytes[i + 1];

    if (cmd === IAC) {
      // Escaped IAC byte (literal 0xFF)
      cleanBytes.push(IAC);
      i += 2;
      continue;
    }

    if (cmd === SB) {
      // Subnegotiation: IAC SB ... IAC SE
      // Find the end (IAC SE)
      let endIdx = i + 2;
      while (endIdx < bytes.length - 1) {
        if (bytes[endIdx] === IAC && bytes[endIdx + 1] === SE) {
          break;
        }
        endIdx++;
      }
      if (endIdx >= bytes.length - 1) {
        // Incomplete subnegotiation - save for next packet
        conn.partialIacBuffer = bytes.slice(i);
        break;
      }
      // Skip the entire subnegotiation block
      i = endIdx + 2;
      continue;
    }

    // DO, DONT, WILL, WONT — all take one option byte
    if (cmd === DO || cmd === DONT || cmd === WILL || cmd === WONT) {
      if (i + 2 >= bytes.length) {
        // Incomplete option negotiation - save for next packet
        conn.partialIacBuffer = bytes.slice(i);
        break;
      }
      const option = bytes[i + 2];

      // Respond to server negotiations:
      // - Refuse all DO requests with WONT (we don't support options)
      // - Refuse all WILL requests with DONT (don't need server options)
      // Exceptions:
      //   - Allow server to WILL SGA (option 3) for smoother output
      //   - Accept DO ECHO (option 1) and DO BINARY (option 0) for proper terminal behavior
      if (cmd === DO) {
        if (option === ECHO || option === BINARY) {
          conn.socket.write(Buffer.from([IAC, WILL, option]));
        } else {
          conn.socket.write(Buffer.from([IAC, WONT, option]));
        }
      } else if (cmd === WILL) {
        // Accept WILL SGA (option 3), WILL ECHO (1), WILL BINARY (0)
        if (option === SGA || option === ECHO || option === BINARY) {
          conn.socket.write(Buffer.from([IAC, DO, option]));
        } else {
          conn.socket.write(Buffer.from([IAC, DONT, option]));
        }
      }
      // WONT and DONT don't need responses
      i += 3;
      continue;
    }

    // Unknown IAC command — skip 2 bytes
    i += 2;
  }

  // Clear partial buffer if we processed everything
  if (i >= bytes.length) {
    conn.partialIacBuffer = Buffer.alloc(0);
  }

  return Buffer.from(cleanBytes).toString('utf8');
}

/**
 * Send NAWS (Negotiate About Window Size) subnegotiation.
 * Format: IAC SB NAWS <cols-high> <cols-low> <rows-high> <rows-low> IAC SE
 */
function sendNAWS(socket, cols, rows) {
  const safeCols = Math.max(0, Math.min(65535, cols || 80));
  const safeRows = Math.max(0, Math.min(65535, rows || 24));
  const nawsBuf = Buffer.from([
    IAC, SB, NAWS,
    (safeCols >> 8) & 0xFF, safeCols & 0xFF,
    (safeRows >> 8) & 0xFF, safeRows & 0xFF,
    IAC, SE
  ]);
  socket.write(nawsBuf);
}

function connectTelnet(tabId, host, port, onData, onClose, onError) {
  disconnectTelnet(tabId);

  const socket = new net.Socket();
  const portNum = parseInt(port) || 23;

  const conn = { socket, cols: 80, rows: 24, partialIacBuffer: Buffer.alloc(0) };
  connections.set(tabId, conn);

  socket.connect(portNum, host, () => {
    // Request binary mode and echo for character-by-character input
    socket.write(Buffer.from([IAC, WILL, BINARY]));
    socket.write(Buffer.from([IAC, DO, ECHO]));
    // Send initial NAWS
    sendNAWS(socket, conn.cols, conn.rows);
    onData(tabId, `Connected to ${host}:${portNum}\r\n`);
  });

  socket.on('data', (data) => {
    const cleanText = processTelnetData(data, conn);
    if (cleanText.length > 0) {
      onData(tabId, cleanText);
    }
  });

  socket.on('close', () => {
    connections.delete(tabId);
    onClose(tabId, 'Connection closed');
  });

  socket.on('error', (err) => {
    onError(tabId, err.message);
    connections.delete(tabId);
  });
}

function writeTelnetData(tabId, data) {
  const conn = connections.get(tabId);
  if (conn && conn.socket) {
    conn.socket.write(data);
  }
}

function resizeTelnet(tabId, cols, rows) {
  const conn = connections.get(tabId);
  if (conn && conn.socket) {
    conn.cols = cols;
    conn.rows = rows;
    sendNAWS(conn.socket, cols, rows);
  }
}

function disconnectTelnet(tabId) {
  const conn = connections.get(tabId);
  if (conn && conn.socket) {
    try { conn.socket.destroy(); } catch (e) {}
    connections.delete(tabId);
  }
}

// Disconnect all telnet connections (used on app quit)
function disconnectAllTelnet() {
  for (const conn of connections.values()) {
    try { conn.socket.destroy(); } catch (e) {}
  }
  connections.clear();
}

module.exports = {
  connectTelnet,
  writeTelnetData,
  resizeTelnet,
  disconnectTelnet,
  disconnectAllTelnet,
};