// Kort pad: node scripts/kit-validate.mjs  (dezelfde controle als `npm run kit:validate`, zonder opnieuw te bouwen)
process.argv.splice(2, 0, "validate");
await import("./kit.mjs");
