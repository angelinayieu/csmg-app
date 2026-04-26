/* global React, ReactDOM, SECTIONS, RAIL_ICONS, RAIL_AVATARS, COLLABORATORS, Ic, CheckinPanel, TwinPanel, PerfPanel */
const { useState: useA } = React;

function Rail() {
  return (
    <div className="rail">
      {RAIL_ICONS.map((r,i) => {
        const Icon = Ic[r.icon];
        return (
          <button key={r.id} className={"rail-btn" + (r.active?" active":"")}>
            <Icon/>
          </button>
        );
      })}
      <div style={{flex:1}}/>
      <div className="rail-sep"/>
      {RAIL_AVATARS.map(a => (
        <div key={a.id} className="rail-avatar" style={{ background: a.color }}>{a.label}</div>
      ))}
    </div>
  );
}

function Sidebar() {
  return (
    <div className="sidebar">
      <div className="sb-head">
        <Ic.stack/>
        SECTIONS
      </div>
      {SECTIONS.map(g => (
        <div key={g.group}>
          <div className="sb-group">{g.group}</div>
          {g.items.map(it => {
            const Icon = Ic[it.icon];
            return (
              <div key={it.id} className={"sb-item" + (it.active ? " active" : "")}>
                <Icon/>
                <span>{it.label}</span>
                {it.chev && <Ic.chevR className="sb-chev" width="12" height="12"/>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function TopBar() {
  const [mode, setMode] = useA("objective");
  return (
    <div className="topbar">
      <div className="notif-pill">
        <span className="notif-ico"><Ic.box/></span>
        <div>
          <b>X company released a new database,</b><br/>
          <span>New proposal for prompt engineering since yesterday</span>
        </div>
        <span className="notif-dot"/>
      </div>
      <div className="tb-right" style={{position:"relative"}}>
        <div className="tb-callout">Agents / Real people working on it<br/>expand to see their role + contributions</div>
        <div className="avatar-stack">
          {COLLABORATORS.map(c => (
            <div key={c.id} className="av" style={{ background: c.color }}>{c.label}</div>
          ))}
        </div>
        <button className="collab-btn"><Ic.people width="14" height="14"/>Collaborate <Ic.chevR width="10" height="10"/></button>
        <div style={{position:"relative"}}>
          <button className="rail-btn" style={{width:32,height:32,background:"rgba(255,255,255,0.6)",border:"1px solid var(--glass-border)"}}>
            <Ic.chat width="14" height="14"/>
          </button>
        </div>
        <div className="tb-menu-card">
          <div className="tb-menu-item"><Ic.markup width="13" height="13"/>Markup</div>
          <div className="tb-menu-item"><Ic.print  width="13" height="13"/>Print</div>
        </div>
      </div>
    </div>
  );
}

function Hero() {
  const [label, setLabel] = useA("label");
  return (
    <div className="hero">
      <div>
        <div className="hero-label">Main Objective</div>
        <h1>Decomposition Prompt Optimization</h1>
        <div className="hero-sub">
          Optimizing a decomposition prompt for situational analysis by enhancing sophistication, density, and depth.
        </div>
        <div className="hero-stats">
          <div className="hero-stat"><span className="ico"><Ic.entities width="12" height="12"/></span><span className="v">136</span><span>Entities</span></div>
          <div className="hero-stat"><span className="ico" style={{color:"#0a6aee"}}><Ic.edges width="12" height="12"/></span><span className="v">59</span><span>Edges</span></div>
          <div className="hero-stat"><span className="ico" style={{color:"#7a8698"}}><Ic.cycles width="12" height="12"/></span><span className="v">0</span><span>Cycles</span></div>
        </div>
      </div>
      <div className="hero-right">
        <div className="hero-goal-head">
          <span className="label-chip">Main Objective</span>
          <div className="toggle">
            <button className={label==="label"?"on":""} onClick={()=>setLabel("label")}>Label</button>
          </div>
        </div>
        <div className="hero-goal">
          <div style={{fontSize:11, color:"#7a8698", letterSpacing:"0.12em", textTransform:"uppercase", fontWeight:600}}>Ultimate Goal</div>
          <h2>No goal set</h2>
          <p>Set an ultimate goal to anchor this project.</p>
        </div>
        <div className="hero-status-chip">Twin — not initialized</div>
      </div>
    </div>
  );
}

function App() {
  return (
    <>
      <div className="page-bg"/>
      <div className="app">
        <Rail/>
        <Sidebar/>
        <div className="main">
          <TopBar/>
          <Hero/>
          <div className="panels">
            <CheckinPanel/>
            <TwinPanel/>
            <PerfPanel/>
          </div>
        </div>
      </div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
