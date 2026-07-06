export function getRelativeDateLabel(dateInput: Date | string): string {
    const date = new Date(dateInput);
    const now = new Date();

    const today = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
    );

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const compareDate = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    );

    if (compareDate.getTime() === today.getTime()) {
        return "Today";
    } else if (compareDate.getTime() === yesterday.getTime()) {
        return "Yesterday";
    } else if (compareDate > sevenDaysAgo) {
        return "Previous 7 Days";
    } else if (compareDate > thirtyDaysAgo) {
        return "Previous 30 Days";
    } else {
        return date.getFullYear() === now.getFullYear()
            ? date.toLocaleString("default", {
                  month: "long",
              })
            : date.getFullYear().toString();
    }
}