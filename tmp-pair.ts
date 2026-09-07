import { getDb, migrate } from './src/engine/db.ts';
import { learn } from './src/engine/testing/graph.ts';
import { recordDelegationState, delegationRecords } from './src/engine/delegation.ts';
import { writeFileSync } from 'node:fs';

// A real graph on disk, built the way the seed builds one: a deploy capability
// that rests hard on a credential, granted unattended.
const db = getDb(process.argv[2]);
migrate(db as never);
db.prepare(`INSERT OR REPLACE INTO capabilities (id,name,domain,description,category,state,kind,lifecycle,maturity_score,unlock_cost_setup,updated_at)
  VALUES ('combo:deploy','Deploy','ops','','','unlocked','capability','reliable',0,0,datetime('now'))`).run();
db.prepare(`INSERT OR REPLACE INTO capabilities (id,name,domain,description,category,state,kind,lifecycle,maturity_score,unlock_cost_setup,updated_at)
  VALUES ('credential:k8s','Kubeconfig','ops','','','unlocked','credential','broken',0,0,datetime('now'))`).run();
db.prepare(
  `INSERT OR REPLACE INTO dependencies (from_capability,to_capability,is_hard_requisite) VALUES ('credential:k8s','combo:deploy',1)`
).run();
db.prepare(
  `INSERT OR REPLACE INTO authority (capability_id,action,mode,scope,source,holder) VALUES ('combo:deploy','execute','autonomous','','declared','')`
).run();
learn(db, 'credential:k8s', 'failed');

const result = recordDelegationState(db);
const records = delegationRecords(db, 100);
writeFileSync(process.argv[3], records.map(r => JSON.stringify(r)).join('\n') + '\n');
console.log(
  `${process.env.AMBIT_ENV}: wrote ${result.written} records, instance=${records[0]?.system.instance}`
);
