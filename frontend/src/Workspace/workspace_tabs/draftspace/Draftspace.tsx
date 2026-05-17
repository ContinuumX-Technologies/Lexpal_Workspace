import TipTap from "./TipTap";
import TopBar from "./TopBar";
import { DraftspaceProvider } from "./Draftspace.context";
import RightPanel from "./tabs/RightPanel";

function Draftspace() {
  return (
    <DraftspaceProvider>
      <div style={{ display: "flex", height: "100%", minHeight: 0, minWidth: 0, overflow: "hidden", flexDirection: "column" }}>
        {/* Top Bar: Draft name, activity, and navigation */}
        <TopBar />
        
        {/* Main content area: Editor (left) + Right panel (right) */}
        <div style={{ display: "flex", height: "100%", minHeight: 0, minWidth: 0, overflow: "hidden", flex: 1 }}>
          <TipTap />
          <RightPanel />
        </div>
      </div>
    </DraftspaceProvider>
  );
}

export default Draftspace;
