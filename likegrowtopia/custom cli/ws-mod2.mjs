import WebSocket from 'ws';
const ws = new WebSocket('ws://127.0.0.1:8090/ws');
ws.on('open', () => ws.send(JSON.stringify({ type: 'prompt', text: 'apa itu kripto middle class' })));
ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.type === 'result') {
    console.log('ANSWER:', String(msg.summary).slice(0, 200));
    process.exit(0);
  }
  if (msg.type === 'event' && msg.event.type === 'analysis_start') { console.log('PIPELINED'); process.exit(1); }
});
setTimeout(() => { console.log('timeout'); process.exit(1); }, 60000);
