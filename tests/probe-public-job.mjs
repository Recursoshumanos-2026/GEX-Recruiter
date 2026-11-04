import { writeFile, mkdir } from 'node:fs/promises';
await mkdir('diagnostic-output',{recursive:true});
const url='https://jobs.recrutei.com.br/gex-corporation/vacancy/158883-analista-de-dados-senior';
const res=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 GEXTalentsPreview/1.0','Accept':'text/html'}});
const html=await res.text();
console.log('Public page status:',res.status,'chars:',html.length);
if(!res.ok||html.length<400)throw Error('Public page not accessible');
await writeFile('diagnostic-output/public-vacancy.html',html);
for(const match of ['Descrição da vaga','Nosso Jeito','Sobre a vaga','Como vai ser','__NEXT_DATA__','__NUXT__','application/ld+json']){
 const p=html.toLowerCase().indexOf(match.toLowerCase());
 console.log(match,p,p>=0?html.slice(Math.max(0,p-140),p+280).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').slice(0,250):'');
}
