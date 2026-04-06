import { JDSearchProvider, useJDSearch } from "./JDSearch.context";
import SearchPage from "./components/SearchPage";
import ResultsPage from "./components/ResultsPage"

function AppRouter() {
  const { appState } = useJDSearch();

  // Show results page once we have results (or are reloading them)
  if (appState === "results" || appState === "reloading") {
    return <ResultsPage />;
  }

  // idle and loading both render the search page
  // (loading state shows overlay inside SearchPage)
  return <SearchPage />;
}

export default function App() {
  return (
    <JDSearchProvider>
      <AppRouter />
    </JDSearchProvider>
  );
}