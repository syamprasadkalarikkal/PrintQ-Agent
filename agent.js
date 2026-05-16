const { processNextJob, startQueueWorker } = require("./queueWorker");

if (process.argv.includes("--once")) {
  processNextJob()
    .then((job) => {
      if (!job) {
        console.log("No visible queued print jobs.");
      }

      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
} else {
  startQueueWorker();
}
