import TipTap from "./TipTap";
import { DraftspaceProvider } from "./Draftspace.context";
import RightPanel from "./tabs/RightPanel";

function Draftspace() {
  return (
    <DraftspaceProvider>
      <div style={{ display: "flex", height: "100%", minHeight: 0, minWidth: 0, overflow: "hidden" }}>
        <TipTap />
        <RightPanel />
      </div>
    </DraftspaceProvider>
  );
}

export default Draftspace;
