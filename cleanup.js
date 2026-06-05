const supabase = require("./supabase");

const STORAGE_BUCKET = process.env.PRINT_STORAGE_BUCKET || "print-queue";
const DEFAULT_CLEANUP_DELAY_MS = 0;

function configuredCleanupDelay() {
  if (process.env.PRINT_CLEANUP_DELAY_MS === undefined) {
    return DEFAULT_CLEANUP_DELAY_MS;
  }

  const delayMs = Number(process.env.PRINT_CLEANUP_DELAY_MS);
  return Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : DEFAULT_CLEANUP_DELAY_MS;
}

const CLEANUP_DELAY_MS = configuredCleanupDelay();

function jobLabel(job) {
  return job?.id || job?.customer_token || job?.token || job?.file_path || "unknown job";
}

async function removeStoredPdf(job) {
  if (!job?.file_path) return;

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .remove([job.file_path]);

  if (error) throw error;
}

async function archiveJobStats(job) {
  const copies = Math.max(Number(job.copies) || 1, 1);
  const pageCount = Math.max(Number(job.total_print_pages) || Number(job.page_count) || 1, 1);
  const totalPrints = pageCount * copies;

  const colorMode = String(job.color_mode || "").toLowerCase();
  const isColor = !colorMode.includes("black") && !colorMode.includes("white") && !colorMode.includes("mono") && colorMode.includes("color");
  const earnings = Number(job.total_amount || job.price || job.amount || job.cost || job.earnings || 0);
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // 1. Try using the atomic SQL Function (RPC) for perfect concurrency safety
  const { error: rpcError } = await supabase.rpc("increment_daily_print_summary", {
    p_date: today,
    p_copies: totalPrints,
    p_is_color: isColor,
    p_earnings: earnings,
  });

  if (!rpcError) return;

  // 2. Fallback to JS Upsert if the RPC function isn't created in Supabase yet
  console.warn("[cleanup] RPC function not found or failed, falling back to JS upsert:", rpcError.message);

  const { data: existing, error: fetchError } = await supabase
    .from("completed_print_jobs")
    .select("*")
    .eq("report_date", today)
    .maybeSingle();

  if (fetchError) throw fetchError;

  if (existing) {
    const { error: updateError } = await supabase
      .from("completed_print_jobs")
      .update({
        total_prints: (existing.total_prints || 0) + totalPrints,
        black_and_white_prints: (existing.black_and_white_prints || 0) + (isColor ? 0 : totalPrints),
        color_prints: (existing.color_prints || 0) + (isColor ? totalPrints : 0),
        total_earnings: Number(existing.total_earnings || 0) + earnings,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (updateError) throw updateError;
  } else {
    const { error: insertError } = await supabase
      .from("completed_print_jobs")
      .insert([
        {
          report_date: today,
          total_prints: totalPrints,
          black_and_white_prints: isColor ? 0 : totalPrints,
          color_prints: isColor ? totalPrints : 0,
          total_earnings: earnings,
        },
      ]);

    if (insertError) throw insertError;
  }
}

async function cleanupPrintedJob(job) {
  try {
    await archiveJobStats(job);
  } catch (archiveError) {
    console.error("Skipping cleanup because archiving failed:", archiveError);
    throw archiveError;
  }

  await removeStoredPdf(job);
  console.log(`Archived printed job ${jobLabel(job)} and removed its Supabase storage file.`);
}

function schedulePrintedJobCleanup(job, delayMs = CLEANUP_DELAY_MS) {
  if (!job) return null;

  const timer = setTimeout(async () => {
    try {
      await cleanupPrintedJob(job);
    } catch (error) {
      console.error(`Failed to clean up printed job ${jobLabel(job)}:`, error);
    }
  }, Math.max(Number(delayMs) || 0, 0));

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  console.log(
    `Scheduled Supabase cleanup for printed job ${jobLabel(job)} in ${Math.round(
      Math.max(Number(delayMs) || 0, 0) / 1000
    )} seconds.`
  );

  return timer;
}

module.exports = {
  CLEANUP_DELAY_MS,
  cleanupPrintedJob,
  schedulePrintedJobCleanup,
};
