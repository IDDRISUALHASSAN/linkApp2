const fs = require("fs");
const chat = fs.readFileSync(
  "C:\\Users\\ALHASSAN\\Desktop\\my project\\frontend\\LinkAPP1\\app\\chatfiles\\chat.js",
  "utf8",
);
const idx = chat.indexOf("ListEmptyComponent");
console.log(chat.slice(idx - 400, idx + 1200));
