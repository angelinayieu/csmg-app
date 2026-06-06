// cytoscape-fcose ships no TypeScript types. We only ever pass it to
// `cytoscape.use(fcose)`, so a bare module declaration (typed as the default
// export = any) is enough.
declare module "cytoscape-fcose";
