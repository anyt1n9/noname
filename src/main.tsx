import { render } from 'preact';
import { App } from './ui/App';
import { applyTheme, loadThemePreference } from './ui/theme';
import './ui/styles.css';

applyTheme(loadThemePreference());
render(<App />, document.getElementById('app')!);
