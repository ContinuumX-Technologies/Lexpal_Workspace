export default function getConfig(mode) {
  if (mode === "high") {
    return {
      model: "gpt-4o-mini",
      branches: 5,
      maxThoughts: 3
    };
  }

  return {
    model: "gpt-4o-mini",
    branches: 3,
    maxThoughts: 3
  };
}