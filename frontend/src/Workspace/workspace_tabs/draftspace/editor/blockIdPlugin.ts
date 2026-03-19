import { Extension } from '@tiptap/core';

export interface BlockIdOptions {
    types: string[];
}

export const BlockId = Extension.create<BlockIdOptions>({
    name: 'blockId',

    addOptions() {
        return {
            types: ['paragraph', 'heading', 'orderedList', 'listItem'],
        };
    },

    addGlobalAttributes() {
        return [
            {
                types: this.options.types,
                attributes: {
                    blockId: {
                        default: null,
                        parseHTML: element => element.getAttribute('data-block-id'),
                        renderHTML: attributes => {
                            if (!attributes.blockId) {
                                return {};
                            }

                            return {
                                'data-block-id': attributes.blockId,
                            };
                        },
                    },
                },
            },
        ];
    },
});
