const motionButton=document.querySelector('#motion-toggle');
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
function updateMotionPreference(){
 document.querySelector('#motion-note').textContent=reducedMotion.matches?'Your reduced-motion preference is on. The foxes stay still.':'Animations are decorative. Status text always explains what is happening.';
 motionButton.disabled=reducedMotion.matches;
 motionButton.textContent=reducedMotion.matches?'Reduced motion on':document.body.classList.contains('motion-paused')?'Resume animations':'Pause animations';
}
motionButton.addEventListener('click',()=>{
 const paused=document.body.classList.toggle('motion-paused');
 motionButton.setAttribute('aria-pressed',String(paused));
 updateMotionPreference();
});
reducedMotion.addEventListener('change',updateMotionPreference);
updateMotionPreference();
