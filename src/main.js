const { CONFIG } = require("./config");
const { createWebServer } = require("./webServer");

function main() {
  const port = Number(process.env.PORT || 3000);
  const server = createWebServer({
    config: CONFIG
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Interface web locale : http://127.0.0.1:${port}`);
  });
}

main();
