export const styleOccasions = [
  { id: "everyday", label: "Everyday, upgraded", note: "Pieces that earn a place in your weekly rotation." },
  { id: "work", label: "Work, without uniform", note: "Polished enough for the room, still recognisably you." },
  { id: "dinner", label: "Dinner or date", note: "A little intention, no overthinking." },
  { id: "event", label: "A big entrance", note: "The look people remember the next morning." },
] as const;

export const styleSilhouettes = [
  { id: "tailored", label: "Clean & tailored", image: "/images/style-quiz-tailored.png" },
  { id: "fluid", label: "Soft & fluid", image: "/images/style-quiz-fluid.png" },
  { id: "relaxed", label: "Relaxed volume", image: "/images/style-quiz-relaxed.png" },
  { id: "statement", label: "Sculptural", image: "/images/style-quiz-cobalt.png" },
] as const;

export const stylePalettes = [
  { id: "quiet", label: "Quiet neutrals", colors: ["#e7e0d4", "#b8ad9d", "#5a554f"] },
  { id: "earthy", label: "Warm earth", colors: ["#eab17c", "#a45138", "#584335"] },
  { id: "bright", label: "Colour energy", colors: ["#e6573f", "#315ece", "#f0ca58"] },
  { id: "dark", label: "After dark", colors: ["#25272a", "#463141", "#777375"] },
] as const;

export const stylePriorities = [
  { id: "comfort", label: "Comfort first", note: "I need to forget I am wearing it." },
  { id: "versatility", label: "More than one life", note: "It should work harder than one occasion." },
  { id: "impact", label: "Instant impact", note: "I want the silhouette to do the talking." },
  { id: "detail", label: "Beautiful details", note: "Fabric, finish and construction win me over." },
] as const;

export const styleLooks = [
  { id: "tailored", label: "The Ivory Edit", tag: "sharp", image: "/images/style-quiz-tailored.png" },
  { id: "fluid", label: "Sage in Motion", tag: "fluid", image: "/images/style-quiz-fluid.png" },
  { id: "cobalt", label: "Electric Form", tag: "bold", image: "/images/style-quiz-cobalt.png" },
  { id: "denim", label: "Indigo Utility", tag: "everyday", image: "/images/style-quiz-denim.png" },
  { id: "knit", label: "Tomato Column", tag: "confident", image: "/images/style-quiz-knit.png" },
  { id: "relaxed", label: "Soft Yellow", tag: "easy", image: "/images/style-quiz-relaxed.png" },
  { id: "street", label: "Plum Shift", tag: "urban", image: "/images/style-quiz-street.png" },
  { id: "metallic", label: "Silver Fold", tag: "night", image: "/images/style-quiz-metallic.png" },
] as const;

export type StyleProfile = {
  occasion: string;
  silhouette: string;
  palette: string;
  priorities: string[];
  lookIds: string[];
};

export function isStyleProfile(value: unknown): value is StyleProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as StyleProfile;
  return hasId(styleOccasions, profile.occasion)
    && hasId(styleSilhouettes, profile.silhouette)
    && hasId(stylePalettes, profile.palette)
    && uniqueIds(profile.priorities, stylePriorities, 2)
    && uniqueIds(profile.lookIds, styleLooks, 3);
}

function hasId(options: readonly { id: string }[], value: unknown) {
  return typeof value === "string" && options.some((option) => option.id === value);
}

function uniqueIds(values: unknown, options: readonly { id: string }[], length: number) {
  return Array.isArray(values)
    && values.length === length
    && new Set(values).size === length
    && values.every((value) => hasId(options, value));
}
