import './ui/styles/fonts.css';
import './ui/styles/tokens.css';
import './ui/styles/base.css';
import { mountApp } from './ui/app';
import { sampleBoard } from './ui/sample-board';

const root = document.getElementById('app');
if (root === null) throw new Error('the page has no #app element');
mountApp(root, sampleBoard());
