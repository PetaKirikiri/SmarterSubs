import { useState } from 'react';
import { SupabaseInspector } from './components/SupabaseInspector';
import { PhoneticInspector } from './components/PhoneticInspector';

type ViewMode = 'supabase' | 'phonetic';

function App() {
  const [currentView, setCurrentView] = useState<ViewMode>('supabase');

  return (
    <div>
      <div
        style={{
          padding: '15px 20px',
          backgroundColor: '#f5f5f5',
          borderBottom: '2px solid #ddd',
          display: 'flex',
          gap: '10px',
        }}
      >
        <button
          onClick={() => setCurrentView('supabase')}
          style={{
            padding: '10px 20px',
            fontSize: '16px',
            cursor: 'pointer',
            backgroundColor: currentView === 'supabase' ? '#007bff' : '#fff',
            color: currentView === 'supabase' ? '#fff' : '#333',
            border: '1px solid #ccc',
            borderRadius: '4px',
            fontWeight: currentView === 'supabase' ? 'bold' : 'normal',
          }}
        >
          Supabase Inspector
        </button>
        <button
          onClick={() => setCurrentView('phonetic')}
          style={{
            padding: '10px 20px',
            fontSize: '16px',
            cursor: 'pointer',
            backgroundColor: currentView === 'phonetic' ? '#007bff' : '#fff',
            color: currentView === 'phonetic' ? '#fff' : '#333',
            border: '1px solid #ccc',
            borderRadius: '4px',
            fontWeight: currentView === 'phonetic' ? 'bold' : 'normal',
          }}
        >
          Phonetic Inspector
        </button>
      </div>
      {currentView === 'supabase' ? <SupabaseInspector /> : <PhoneticInspector />}
    </div>
  );
}

export default App;
