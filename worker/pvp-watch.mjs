import {scanPvpKills} from "../shared/pvp-scan.mjs";
export async function watchPvpKills(db){
  return scanPvpKills(db,{batchSize:24,minimumGapMs:8000,caller:"WORKER"});
}
