import './ui/styles/fonts.css';
import './ui/styles/tokens.css';
import './ui/styles/base.css';
import './ui/styles/layout.css';
import './ui/styles/components.css';
import './ui/styles/atmosphere.css';
import './ui/styles/motion.css';
import { mountApp } from './ui/app';
import { browserAtmosphere } from './ui/atmosphere/index';
import { sampleBoard } from './ui/sample-board';
import { sampleScript } from './ui/tour/sample-script';
import { browserServices } from './ui/services';

const root = document.getElementById('app');
if (root === null) throw new Error('the page has no #app element');

const services = browserServices();
mountApp(root, sampleBoard(), { services, atmosphere: browserAtmosphere(services.frame, services.timers), tour: sampleScript });
