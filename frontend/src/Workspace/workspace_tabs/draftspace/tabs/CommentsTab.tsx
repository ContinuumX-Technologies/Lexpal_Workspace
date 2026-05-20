import { useState } from "react";
import { useDraftStore } from "../store/draftStore";
import { useUserStore } from "@/store/userStore";
import styles from "./CommentsTab.module.css";

export default function CommentsTab() {
  const { activeDraftId, drafts, addComment } = useDraftStore();
  const { currentUser } = useUserStore();
  const [newComment, setNewComment] = useState("");

  const currentDraft = drafts[activeDraftId];
  const comments = currentDraft?.comments || [];

  const handleAddComment = () => {
    if (!newComment.trim()) return;
    addComment(activeDraftId, {
      authorId: currentUser.id,
      authorName: currentUser.name,
      text: newComment
    });
    setNewComment("");
  };

  return (
    <div className={styles.container}>
      <div className={styles.commentList}>
        {comments.length === 0 ? (
          <div className={styles.emptyState}>
            <p>No comments yet. Leave a note for your team!</p>
          </div>
        ) : (
          comments.map((comment) => (
            <div key={comment.id} className={styles.commentCard}>
              <div className={styles.commentHeader}>
                <span className={styles.author}>{comment.authorName}</span>
                <span className={styles.time}>
                  {new Date(comment.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className={styles.text}>{comment.text}</p>
            </div>
          ))
        )}
      </div>

      <div className={styles.inputArea}>
        <textarea
          placeholder="Add a comment..."
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          className={styles.textarea}
        />
        <button 
          onClick={handleAddComment}
          disabled={!newComment.trim()}
          className={styles.postBtn}
        >
          Post Comment
        </button>
      </div>
    </div>
  );
}
