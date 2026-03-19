import { OrderedList } from '@tiptap/extension-ordered-list';

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        orderedListStyled: {
            /** Set ordered list style type: '1' | 'a' | 'i' */
            setOrderedListType: (listType: '1' | 'a' | 'i') => ReturnType;
        };
    }
}

export const OrderedListStyled = OrderedList.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            listType: {
                default: '1',
                parseHTML: element => element.getAttribute('type') || '1',
                renderHTML: attributes => ({
                    type: attributes['listType'],
                }),
            },
        };
    },

    addCommands() {
        return {
            ...this.parent?.(),
            setOrderedListType:
                (listType: '1' | 'a' | 'i') =>
                    ({ commands }) => {
                        return commands.updateAttributes('orderedList', { listType });
                    },
        };
    },
});
