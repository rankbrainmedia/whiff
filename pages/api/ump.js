// pages/api/ump.js
// Umpire strike % data from Covers.com 2025 season
// STR% = % of called pitches ruled strikes. Average ~64%.
// Above average = larger zone = more Ks. Below = tighter = fewer Ks.

const UMP_DATA = {
  // name (lowercase) → { strPct, kAdj, rating }
  // kAdj = projected K adjustment per pitcher (-1.0 to +1.0)
  'mark ripperger':    { strPct: 65.52, kAdj:  0.8, rating: 'large' },
  'john bacon':        { strPct: 65.06, kAdj:  0.7, rating: 'large' },
  'chris segal':       { strPct: 64.98, kAdj:  0.6, rating: 'large' },
  'chad fairchild':    { strPct: 64.92, kAdj:  0.6, rating: 'large' },
  'ron kulpa':         { strPct: 64.94, kAdj:  0.6, rating: 'large' },
  'ben may':           { strPct: 65.00, kAdj:  0.7, rating: 'large' },
  'mike muchlinski':   { strPct: 64.78, kAdj:  0.5, rating: 'large' },
  'dexter kelley':     { strPct: 66.03, kAdj:  1.0, rating: 'large' },
  'steven jaschinski': { strPct: 64.24, kAdj:  0.3, rating: 'average' },
  'jen pawol':         { strPct: 64.38, kAdj:  0.3, rating: 'average' },
  'brian o\'nora':     { strPct: 64.79, kAdj:  0.5, rating: 'large' },
  'alex tosi':         { strPct: 64.79, kAdj:  0.5, rating: 'large' },
  'dan merzel':        { strPct: 64.74, kAdj:  0.5, rating: 'large' },
  'laz diaz':          { strPct: 64.65, kAdj:  0.4, rating: 'average' },
  'edwin jimenez':     { strPct: 64.59, kAdj:  0.4, rating: 'average' },
  'jordan baker':      { strPct: 64.56, kAdj:  0.4, rating: 'average' },
  'tom hanahan':       { strPct: 64.53, kAdj:  0.3, rating: 'average' },
  'gabe morales':      { strPct: 64.40, kAdj:  0.3, rating: 'average' },
  'david rackley':     { strPct: 64.43, kAdj:  0.3, rating: 'average' },
  'mark carlson':      { strPct: 64.50, kAdj:  0.3, rating: 'average' },
  'chad whitson':      { strPct: 64.05, kAdj:  0.2, rating: 'average' },
  'dan bellino':       { strPct: 63.08, kAdj:  0.0, rating: 'average' },
  'hunter wendelstedt':{ strPct: 63.21, kAdj:  0.0, rating: 'average' },
  'malachi moore':     { strPct: 63.21, kAdj:  0.0, rating: 'average' },
  'james jean':        { strPct: 63.46, kAdj:  0.2, rating: 'average' },
  'shane livensparger':{ strPct: 64.24, kAdj:  0.3, rating: 'average' },
  'brock ballou':      { strPct: 63.24, kAdj:  0.0, rating: 'average' },
  'brian walsh':       { strPct: 63.48, kAdj:  0.2, rating: 'average' },
  'vic carapazza':     { strPct: 64.60, kAdj:  0.4, rating: 'average' },
  'chris guccione':    { strPct: 63.49, kAdj:  0.2, rating: 'average' },
  'alan porter':       { strPct: 64.08, kAdj:  0.2, rating: 'average' },
  'bill miller':       { strPct: 64.17, kAdj:  0.2, rating: 'average' },
  'andy fletcher':     { strPct: 63.83, kAdj:  0.1, rating: 'average' },
  'manny gonzalez':    { strPct: 63.87, kAdj:  0.1, rating: 'average' },
  'jim wolf':          { strPct: 63.86, kAdj:  0.1, rating: 'average' },
  'sean barber':       { strPct: 64.07, kAdj:  0.2, rating: 'average' },
  'jeremie rehak':     { strPct: 64.45, kAdj:  0.3, rating: 'average' },
  'john tumpane':      { strPct: 64.26, kAdj:  0.3, rating: 'average' },
  'adam hamari':       { strPct: 64.33, kAdj:  0.3, rating: 'average' },
  'tripp gibson':      { strPct: 63.63, kAdj:  0.1, rating: 'average' },
  'mike estabrook':    { strPct: 63.82, kAdj:  0.1, rating: 'average' },
  'nate tomlinson':    { strPct: 63.30, kAdj:  0.0, rating: 'average' },
  'stu scheurwater':   { strPct: 63.77, kAdj:  0.1, rating: 'average' },
  'roberto ortiz':     { strPct: 64.25, kAdj:  0.3, rating: 'average' },
  'james hoye':        { strPct: 64.11, kAdj:  0.2, rating: 'average' },
  'clint vondrak':     { strPct: 64.26, kAdj:  0.3, rating: 'average' },
  'chris conroy':      { strPct: 63.59, kAdj:  0.1, rating: 'average' },
  'jansen visconti':   { strPct: 64.00, kAdj:  0.2, rating: 'average' },
  'erich bacchus':     { strPct: 63.22, kAdj:  0.0, rating: 'average' },
  'quinn wolcott':     { strPct: 63.84, kAdj:  0.1, rating: 'average' },
  'ryan additon':      { strPct: 63.34, kAdj:  0.0, rating: 'average' },
  'derek thomas':      { strPct: 63.70, kAdj:  0.1, rating: 'average' },
  'junior valentine':  { strPct: 63.30, kAdj:  0.0, rating: 'average' },
  'brennan miller':    { strPct: 64.00, kAdj:  0.2, rating: 'average' },
  'ramon de jesus':    { strPct: 64.29, kAdj:  0.3, rating: 'average' },
  'adrian johnson':    { strPct: 64.44, kAdj:  0.3, rating: 'average' },
  'nestor ceja':       { strPct: 64.27, kAdj:  0.3, rating: 'average' },
  'd.j. reyburn':      { strPct: 64.70, kAdj:  0.5, rating: 'large' },
  'austin jones':      { strPct: 63.97, kAdj:  0.1, rating: 'average' },
  'ryan wills':        { strPct: 63.50, kAdj:  0.1, rating: 'average' },
  'jonathan parra':    { strPct: 61.84, kAdj: -0.5, rating: 'tight' },
  'mark wegner':       { strPct: 63.25, kAdj:  0.0, rating: 'average' },
  'tony randazzo':     { strPct: 64.02, kAdj:  0.2, rating: 'average' },
  'carlos torres':     { strPct: 63.79, kAdj:  0.1, rating: 'average' },
  'john bacon':        { strPct: 65.06, kAdj:  0.7, rating: 'large' },
  'will little':       { strPct: 63.32, kAdj:  0.0, rating: 'average' },
  'bruce dreckman':    { strPct: 63.61, kAdj:  0.1, rating: 'average' },
  'marvin hudson':     { strPct: 63.60, kAdj:  0.1, rating: 'average' },
  'laz diaz':          { strPct: 64.65, kAdj:  0.4, rating: 'average' },
  'cb bucknor':        { strPct: 62.93, kAdj: -0.2, rating: 'tight' },
  'scott barry':       { strPct: 62.54, kAdj: -0.4, rating: 'tight' },
  'lance barksdale':   { strPct: 62.36, kAdj: -0.5, rating: 'tight' },
  'doug eddings':      { strPct: 64.67, kAdj:  0.4, rating: 'average' },
  'lance barrett':     { strPct: 64.27, kAdj:  0.3, rating: 'average' },
  'tyler jones':       { strPct: 61.52, kAdj: -0.6, rating: 'tight' },
};

function lookupUmp(name) {
  if (!name) return null;
  const key = name.toLowerCase().trim();
  // Direct match
  if (UMP_DATA[key]) return { name, ...UMP_DATA[key] };
  // Partial last name match
  const lastName = key.split(' ').pop();
  const match = Object.entries(UMP_DATA).find(([k]) => k.endsWith(lastName));
  if (match) return { name, ...match[1] };
  // Return neutral if unknown
  return { name, strPct: 64.0, kAdj: 0, rating: 'average', unknown: true };
}

export { lookupUmp, UMP_DATA };
export default function handler(req, res) {
  const { name } = req.query;
  return res.status(200).json(lookupUmp(name));
}
