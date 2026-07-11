import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

// Explicitly point to the .env file in the server directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') }); 

interface IEnrichment {
  source_docId: string;
  title: string;
  cited_judgements?: { docId: string; title: string }[];
  cited_laws?: any[];
  cited_by?: { docId: string; title: string }[];
}

const EnrichmentSchema = new mongoose.Schema<IEnrichment>({
  source_docId: String,
  title: String,
  cited_judgements: [{ docId: String, title: String }],
  cited_laws: mongoose.Schema.Types.Mixed,
  cited_by: [{ docId: String, title: String }]
}, { strict: false });

// Ensure the collection name matches your actual MongoDB collection
const EnrichmentModel = mongoose.model<IEnrichment>('supreme_court_enrichement', EnrichmentSchema, 'supreme_court_enrichement');

// Helper function to draw a dynamic progress bar in the console
function drawProgressBar(current: number, total: number, label: string) {
  const percentage = total === 0 ? 100 : Math.round((current / total) * 100);
  const barWidth = 40;
  const filledWidth = Math.round((percentage / 100) * barWidth);
  const emptyWidth = barWidth - filledWidth;
  
  const filledBar = '█'.repeat(filledWidth);
  const emptyBar = '░'.repeat(emptyWidth);
  
  process.stdout.write(`\r${label} [${filledBar}${emptyBar}] ${percentage}% (${current}/${total})`);
}

async function generateCitedBy() {
  try {
    const mongoUri = process.env.MONGO_CONNECTION_URL || 'mongodb://localhost:27017/lexpal';
    const dbName = process.env.MONGO_DB_NAME || "Lexpal_Workspace"; 
    
    console.log(`Connecting to MongoDB Cluster...`);
    await mongoose.connect(mongoUri, { dbName: dbName });
    console.log(`Connected successfully to Database: "${dbName}"`);

    const args = process.argv.slice(2);
    const docIdIndex = args.indexOf('--docId');
    const targetDocId = docIdIndex !== -1 ? args[docIdIndex + 1] : null;

    if (targetDocId) {
      // ---------------------------------------------------------
      // SINGLE DOCUMENT MODE
      // ---------------------------------------------------------
      console.log(`\n--- Single Document Mode ---`);
      console.log(`Finding all judgements that cite docId: ${targetDocId}`);

      const citingDocs = await EnrichmentModel.find(
        { "cited_judgements.docId": targetDocId },
        { source_docId: 1, title: 1 }
      ).lean();

      if (citingDocs.length === 0) {
        console.log(`No documents found in the database that cite docId: ${targetDocId}.`);
      } else {
        const uniqueCitedBy = new Map<string, string>();
        
        citingDocs.forEach(doc => {
          if (doc.source_docId) {
            uniqueCitedBy.set(doc.source_docId, doc.title);
          }
        });

        const citedByArray = Array.from(uniqueCitedBy.entries()).map(([docId, title]) => ({
          docId,
          title
        }));

        console.log(`Found ${citedByArray.length} unique judgements citing ${targetDocId}. Updating...`);

        const updateResult = await EnrichmentModel.updateOne(
          { source_docId: targetDocId },
          { $set: { cited_by: citedByArray } }
        );

        console.log(`Update Result: Matched ${updateResult.matchedCount}, Modified ${updateResult.modifiedCount}`);
      }

    } else {
      // ---------------------------------------------------------
      // FAST BULK MODE (IN-MEMORY AGGREGATION)
      // ---------------------------------------------------------
      console.log(`\n--- Bulk Mode ---`);
      console.log("Fetching documents from database (this may take a moment)...");

      const allDocs = await EnrichmentModel.find(
        { cited_judgements: { $exists: true, $type: 'array', $ne: [] } },
        { source_docId: 1, title: 1, "cited_judgements.docId": 1 }
      ).lean();

      console.log(`Fetched ${allDocs.length} citing documents.\n`);

      const reverseIndex = new Map<string, Map<string, string>>();

      // Phase 1: Building Memory Map
      let mappedCount = 0;
      for (const doc of allDocs) {
        mappedCount++;
        if (mappedCount % 1000 === 0 || mappedCount === allDocs.length) {
          drawProgressBar(mappedCount, allDocs.length, "Building Memory Map  ");
        }

        const citingDocId = doc.source_docId;
        const citingTitle = doc.title;

        if (!citingDocId || !doc.cited_judgements) continue;

        for (const citation of doc.cited_judgements) {
          const targetDocId = citation.docId;
          if (!targetDocId) continue;

          if (!reverseIndex.has(targetDocId)) {
            reverseIndex.set(targetDocId, new Map());
          }
          
          reverseIndex.get(targetDocId)!.set(citingDocId, citingTitle);
        }
      }
      
      console.log(`\n\nCalculated reverse index for ${reverseIndex.size} target documents.`);

      // Phase 2: Building and executing Bulk Operations
      const bulkOps = [];
      let processedTargetsCount = 0;
      let dbWriteCount = 0;
      const totalTargets = reverseIndex.size;

      for (const [targetDocId, citingMap] of reverseIndex.entries()) {
        processedTargetsCount++;
        
        const citedByArray = Array.from(citingMap.entries()).map(([docId, title]) => ({
          docId,
          title
        }));

        bulkOps.push({
          updateOne: {
            filter: { source_docId: targetDocId },
            update: { $set: { cited_by: citedByArray } }
          }
        });

        if (processedTargetsCount % 100 === 0 || processedTargetsCount === totalTargets) {
          drawProgressBar(processedTargetsCount, totalTargets, "Updating Database    ");
        }

        // REDUCED BATCH SIZE TO PREVENT TIMEOUTS
        if (bulkOps.length >= 500) {
          await EnrichmentModel.bulkWrite(bulkOps, { ordered: false });
          dbWriteCount += bulkOps.length;
          bulkOps.length = 0; 
          
          // Give the database cluster a 50ms breather to prevent throttling
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      // Execute remaining operations
      if (bulkOps.length > 0) {
        await EnrichmentModel.bulkWrite(bulkOps, { ordered: false });
        dbWriteCount += bulkOps.length;
      }

      console.log(`\n\nSuccess!`);
      console.log(`Processed ${allDocs.length} original documents.`);
      console.log(`Updated the 'cited_by' field on ${dbWriteCount} target documents.`);
    }
    
  } catch (error) {
    console.error("\nError generating cited_by:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }
}

generateCitedBy();