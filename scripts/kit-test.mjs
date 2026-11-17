// Kort pad: node scripts/kit-test.mjs <kit-id>  (zonder opnieuw te bouwen)
process.argv.splice(2, 0, "test");
await import("./kit.mjs");
