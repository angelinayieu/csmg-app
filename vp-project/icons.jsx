/* global React */
const PI = (props) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}/>;

const Ic = {
  grid:    (p) => <PI {...p}><rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="7" rx="1.2"/><rect x="3" y="14" width="7" height="7" rx="1.2"/><rect x="14" y="14" width="7" height="7" rx="1.2"/></PI>,
  target:  (p) => <PI {...p}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></PI>,
  canvas:  (p) => <PI {...p}><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M7 20h10"/></PI>,
  flask:   (p) => <PI {...p}><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/></PI>,
  board:   (p) => <PI {...p}><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20l4-4 4 4M12 16v4"/></PI>,
  play:    (p) => <PI {...p}><circle cx="12" cy="12" r="9"/><path d="M10 8l6 4-6 4z" fill="currentColor"/></PI>,
  bulb:    (p) => <PI {...p}><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c1 1 1.5 2 1.5 3.5h5c0-1.5.5-2.5 1.5-3.5A6 6 0 0 0 12 3z"/></PI>,
  graph:   (p) => <PI {...p}><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7.5 7.5L11 16.5M16.5 7.5L13 16.5M8 6h8"/></PI>,
  prob:    (p) => <PI {...p}><circle cx="8" cy="9" r="4"/><circle cx="16" cy="15" r="4"/></PI>,
  twin:    (p) => <PI {...p}><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/></PI>,
  gear2:   (p) => <PI {...p}><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2 2M16.4 16.4l2 2M5.6 18.4l2-2M16.4 7.6l2-2"/></PI>,
  layers:  (p) => <PI {...p}><path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 18l9 5 9-5"/></PI>,
  box:     (p) => <PI {...p}><path d="M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4M21 7v10l-9 4"/></PI>,
  chess:   (p) => <PI {...p}><path d="M8 4h8v3l-2 2v3l3 2v3H7v-3l3-2V9L8 7V4zM6 20h12"/></PI>,
  chain:   (p) => <PI {...p}><path d="M10 14a4 4 0 0 1 0-5.6l2-2a4 4 0 0 1 5.6 5.6l-1 1M14 10a4 4 0 0 1 0 5.6l-2 2a4 4 0 0 1-5.6-5.6l1-1"/></PI>,
  radar:   (p) => <PI {...p}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6-4"/><circle cx="16" cy="7" r="1" fill="currentColor"/></PI>,

  bolt:    (p) => <PI {...p}><path d="M13 3L4 14h7l-1 7 9-12h-7l1-6z"/></PI>,
  alert:   (p) => <PI {...p}><path d="M12 3L2 20h20L12 3zM12 10v5M12 17v.5"/></PI>,
  plus:    (p) => <PI {...p}><path d="M12 5v14M5 12h14"/></PI>,
  link:    (p) => <PI {...p}><path d="M10 14a4 4 0 0 1 0-5.6l2-2a4 4 0 0 1 5.6 5.6M14 10a4 4 0 0 1 0 5.6l-2 2a4 4 0 0 1-5.6-5.6"/></PI>,
  tree:    (p) => <PI {...p}><circle cx="12" cy="5" r="2"/><circle cx="6" cy="13" r="2"/><circle cx="18" cy="13" r="2"/><circle cx="10" cy="20" r="1.5"/><circle cx="14" cy="20" r="1.5"/><path d="M12 7l-6 4M12 7l6 4M6 15l4 4M18 15l-4 4"/></PI>,
  branch:  (p) => <PI {...p}><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 7v10M8 5a6 6 0 0 1 6 6h2M8 19a6 6 0 0 1 6-6"/></PI>,
  stack:   (p) => <PI {...p}><rect x="4" y="4" width="16" height="4" rx="1"/><rect x="4" y="10" width="16" height="4" rx="1"/><rect x="4" y="16" width="16" height="4" rx="1"/></PI>,
  bar:     (p) => <PI {...p}><path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/></PI>,
  info:    (p) => <PI {...p}><circle cx="12" cy="12" r="9"/><path d="M12 8v.5M11 11h1v6"/></PI>,
  gear:    (p) => <PI {...p}><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4.9a7 7 0 0 0-2-1.2l-.4-2.5h-4l-.4 2.5a7 7 0 0 0-2 1.2l-2.4-.9-2 3.4 2 1.6c-.1.4-.1.8-.1 1.2s0 .8.1 1.2l-2 1.6 2 3.4 2.4-.9a7 7 0 0 0 2 1.2l.4 2.5h4l.4-2.5a7 7 0 0 0 2-1.2l2.4.9 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/></PI>,

  bell:    (p) => <PI {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0"/></PI>,
  chevR:   (p) => <PI {...p}><path d="M9 6l6 6-6 6"/></PI>,
  people:  (p) => <PI {...p}><circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3 20a6 6 0 0 1 12 0M14 20a5 5 0 0 1 7 0"/></PI>,
  chat:    (p) => <PI {...p}><path d="M3 5h18v12H8l-5 4V5z"/></PI>,
  entities:(p) => <PI {...p}><circle cx="12" cy="12" r="3"/><circle cx="4" cy="6" r="2"/><circle cx="20" cy="6" r="2"/><circle cx="4" cy="18" r="2"/><circle cx="20" cy="18" r="2"/><path d="M6 7l4 4M18 7l-4 4M6 17l4-4M18 17l-4-4"/></PI>,
  edges:   (p) => <PI {...p}><circle cx="5" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h10"/></PI>,
  cycles:  (p) => <PI {...p}><path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/></PI>,
  markup:  (p) => <PI {...p}><path d="M4 20l4-1 12-12-3-3L5 16l-1 4z"/></PI>,
  print:   (p) => <PI {...p}><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z"/></PI>,

  arrow:   (p) => <PI {...p}><path d="M5 12h14M13 6l6 6-6 6"/></PI>,
  check:   (p) => <PI {...p}><path d="M5 12l5 5L20 7"/></PI>,
};

window.Ic = Ic;
