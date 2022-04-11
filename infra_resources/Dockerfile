FROM dpage/pgadmin4

ENV PGPASSFILE=/pgadmin4/pgpassfile

USER root 

COPY servers.json /pgadmin4/servers.json

COPY pgpassfile /pgadmin4/pgpassfile 
RUN chmod 600 /pgadmin4/pgpassfile