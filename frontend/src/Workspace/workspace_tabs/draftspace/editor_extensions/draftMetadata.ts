import { Extension } from "@tiptap/core";

export const DraftMetadataExtension = Extension.create({
  name: "draftMetadata",

  addGlobalAttributes() {
    return [
      {
        types: [
          "doc",
          "heading",
          "paragraph",
          "bulletList",
          "orderedList",
          "listItem",
          "table",
          "tableRow",
          "tableCell",
          "blockquote",
        ],

        attributes: {
          lexpalId: {
            default: null,
          },

          memo: {
            default: null,
          },

          precedingHeadingId: {
            default: null,
          },

          // Legacy key for backward compatibility with older persisted drafts.
          // nearestPrecedingHeadingId: {
          //   default: null,
          // },
        },
      },
    ];
  },
});
