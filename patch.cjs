const fs = require("fs");
const f =
  "C:\\Users\\ALHASSAN\\Desktop\\my project\\frontend\\LinkAPP1\\components\\CommentSheet.js";
let s = fs.readFileSync(f, "utf8");

// 1. Remove absolute positioning from inputContainer
s = s.replace(
  `  inputContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
    paddingTop: 8,
    zIndex: 2,
    elevation: 2,
  },`,
  `  inputContainer: {
    borderTopWidth: 1,
    paddingTop: 8,
  },`,
);

// 2. Give the FlatList flex:1 so it shrinks when the keyboard lifts the input
s = s.replace(
  `                contentContainerStyle={{
                  paddingHorizontal: 16,
                  paddingTop: 8,
                  paddingBottom: 80 + insets.bottom,
                }}`,
  `                style={{ flex: 1 }}
                contentContainerStyle={{
                  paddingHorizontal: 16,
                  paddingTop: 8,
                  paddingBottom: 80 + insets.bottom,
                }}`,
);

// 3. Support keyboard avoiding on web + Android too
s = s.replace(
  `              behavior={Platform.OS === "ios" ? "padding" : undefined}`,
  `              behavior={Platform.OS === "ios" ? "padding" : "height"}`,
);

// 4. Make the sheet a flex column so the input sits at the bottom naturally
s = s.replace(
  `  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
  },`,
  `  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
    justifyContent: "flex-end",
  },`,
);

fs.writeFileSync(f, s);
console.log("patched CommentSheet.js");
