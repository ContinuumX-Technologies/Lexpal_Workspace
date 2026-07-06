// orchestrator.js
import getConfig from "./config.js";
import {
  extractCase,
  generateBranches,
  runBranch,
  aggregateResults,
  dedupeAndRankDiscoveredLaws
} from "./ helper.js";


export async function runReasoning(query, mode ) {
  const config = getConfig(mode);


  // STEP 1: Extract facts + questions
  const { facts, questions } = await extractCase(query, config);


  //dev test logs
  console.log(facts);
  console.log(questions);



  // STEP 2: Generate branches
  const branches = await generateBranches(facts, questions, config);


  // STEP 3: Run branches in parallel
  // const results = await Promise.all(
  //   branches.map((branch) => runBranch(branch, facts, questions, config))
  // );


  //global store for laws discovered in each thought of every branch
  const global_discovered_laws=[];

  const results = [];
  let i = 0
  for (const branch of branches) {

    i++;

    //dev test logs
    console.log(`running branch ${i} with domain: ${branch.domain}`);
    console.log("purpose of the branch: " + branch.purpose);

    const result = await runBranch(
      branch,
      facts,
      questions,
      config,
      global_discovered_laws
    );

    results.push(result);
  }

  // STEP 4: Final aggregation
  const final={};
  final.discovered_laws = dedupeAndRankDiscoveredLaws(global_discovered_laws, config);
  final.text_content = await aggregateResults(
    results,
    facts,
    questions,
    final.discovered_laws,
    config
  );

  return final;
}
